"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Share2 } from "lucide-react";

import {
  EMPTY_CODEV_PARENT_BRIDGE_SESSION,
  executeCodevBridgeRequest,
  isCodevBridgeClientMessage,
  isCodevBridgeRequestMessage,
  replyToCodevBridgeMessage,
  type CodevParentBridgeSession,
} from "@/components/codev-parent-bridge";
import {
  useLiveAgentActivity,
  WorkspaceAgentActivityRail,
} from "@/components/workspace-agent-activity";
import { WorkspaceRepositoryDialog } from "@/components/workspace-repository-dialog";
import { WorkspaceShareDialog } from "@/components/workspace-share-dialog";
import { emptyLiveAgentCards } from "@/lib/live-agent-activity-view";
import { MAX_PARALLEL_AGENT_SESSIONS } from "@codev/contracts";

type ConnectionPhase =
  | { phase: "connecting" }
  | { phase: "host-starting" }
  | { phase: "ready"; iframeSrc: string; workspacePath: string | null }
  | { phase: "error"; message: string };

const HOST_STARTING_RETRY_MS = 8_000;
const ORCA_THEME_OVERRIDE_HREF = "/orca-theme-overrides.css";
const CODEV_EMPTY_STATE_LOGO_SRC = "/brand/codev-mark-v3.png";

type OrcaConnectResponse = {
  state?: string;
  pairingCode?: string;
  webClientPath?: string;
  workspacePath?: string | null;
  error?: string;
};

type CodevOrcaMessage =
  | { type: "codev:choose-repository" }
  | { type: "codev:project-ready" }
  | { type: "codev:project-error"; message?: string }
  | {
      type: "codev:discard-proposal";
      requestId: string;
      worktreeId: string;
    }
  | { type: "codev:create-proposal"; requestId: string }
  | { type: "codev:bridge-hello"; generation: number }
  | { type: "codev:bridge-ping"; generation: number }
  | { type: "codev:bridge-interrupt"; generation: number }
  | {
      type: "codev:bridge-request";
      generation: number;
      requestId: string;
      method:
        | "invites.list"
        | "invites.create"
        | "invites.revoke"
        | "members.update";
      params?: Record<string, unknown>;
    };

type CodevProposalDiscardResult =
  | { managed: false }
  | { managed: true; ok: true }
  | { managed: true; ok: false; error: string };

type CodevProposalCreateResult =
  | { ok: true; worktreeId: string }
  | { ok: false; error: string; status?: number; code?: string };

const WORKTREE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function discardOrcaManagedProposal(
  workspaceId: string,
  worktreeId: string,
  fetcher: typeof fetch = fetch,
): Promise<CodevProposalDiscardResult> {
  if (!WORKTREE_ID.test(worktreeId)) {
    return { managed: false };
  }
  try {
    const sessionsResponse = await fetcher(
      `/api/workspaces/${workspaceId}/agents`,
      { cache: "no-store" },
    );
    const sessionsPayload = (await sessionsResponse
      .json()
      .catch(() => null)) as unknown;
    if (!sessionsResponse.ok) {
      throw new Error("CoDev could not inspect managed proposals.");
    }
    const sessions =
      sessionsPayload &&
      typeof sessionsPayload === "object" &&
      "sessions" in sessionsPayload &&
      Array.isArray(sessionsPayload.sessions)
        ? sessionsPayload.sessions
        : [];
    const session = sessions.find(
      (candidate): candidate is { id: string; worktreeId: string } =>
        candidate !== null &&
        typeof candidate === "object" &&
        "id" in candidate &&
        typeof candidate.id === "string" &&
        "worktreeId" in candidate &&
        candidate.worktreeId === worktreeId,
    );
    if (!session) {
      return { managed: false };
    }

    const discardResponse = await fetcher(
      `/api/workspaces/${workspaceId}/agents/${session.id}/discard`,
      { method: "POST" },
    );
    const discardPayload = (await discardResponse.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    if (!discardResponse.ok) {
      return {
        managed: true,
        ok: false,
        error:
          typeof discardPayload?.error === "string"
            ? discardPayload.error
            : "CoDev could not discard this proposal.",
      };
    }
    return { managed: true, ok: true };
  } catch (error) {
    return {
      managed: true,
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "CoDev could not discard this proposal.",
    };
  }
}

export async function createOrcaManagedProposal(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<CodevProposalCreateResult> {
  try {
    const response = await fetcher(`/api/workspaces/${workspaceId}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Managed proposal",
        draft: true,
        attachments: [],
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: unknown;
      worktreeId?: unknown;
      code?: unknown;
    } | null;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error:
          typeof payload?.error === "string"
            ? payload.error
            : "CoDev could not prepare this proposal.",
        ...(typeof payload?.code === "string" ? { code: payload.code } : {}),
      };
    }
    const worktreeId =
      typeof payload?.worktreeId === "string" ? payload.worktreeId : "";
    if (!WORKTREE_ID.test(worktreeId)) {
      return {
        ok: false,
        error: "CoDev did not return a managed proposal worktree.",
      };
    }
    return { ok: true, worktreeId };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "CoDev could not prepare this proposal.",
    };
  }
}

export function buildOrcaIframeSource({
  webClientPath,
  pairingCode,
  workspacePath,
  projectKind,
  projectName,
  settingsOnly,
}: {
  webClientPath: string;
  pairingCode: string;
  workspacePath: string;
  projectKind: "git" | "folder";
  projectName?: string;
  /** Render the personal settings surface instead of the workspace IDE. */
  settingsOnly?: boolean;
}) {
  const fragment = new URLSearchParams({
    pairing: pairingCode,
    codev: "1",
    codevProject: workspacePath,
    codevProjectKind: projectKind,
  });
  if (projectName) {
    fragment.set("codevProjectName", projectName);
  }
  if (settingsOnly) {
    fragment.set("codevSettingsOnly", "1");
  }
  return `${webClientPath}#${fragment.toString()}`;
}

/**
 * Adds CoDev-owned branding to the small number of visible Orca surfaces that
 * identify the host product. The iframe remains an unmodified upstream bundle;
 * this is applied after it has loaded from the same CoDev origin.
 */
export function applyOrcaWorkspaceBranding(
  doc: Document,
  workspaceName: string,
) {
  const emptyStateLogo = doc.querySelector<HTMLImageElement>(
    'img[alt="CoDev logo"]',
  );
  if (emptyStateLogo) {
    if (emptyStateLogo.getAttribute("src") !== CODEV_EMPTY_STATE_LOGO_SRC) {
      emptyStateLogo.src = CODEV_EMPTY_STATE_LOGO_SRC;
    }
    emptyStateLogo.classList.add("codev-orca-empty-logo");
  }

  const titlebars = doc.querySelectorAll<HTMLElement>(
    ".titlebar-app-name-main",
  );
  titlebars.forEach((title) => {
    if (title.dataset.codevWorkspaceName !== workspaceName) {
      title.dataset.codevWorkspaceName = workspaceName;
    }
  });

  return Boolean(emptyStateLogo) && titlebars.length > 0;
}

function injectOrcaThemeAndBranding(
  iframe: HTMLIFrameElement,
  workspaceName: string,
) {
  try {
    const doc = iframe.contentDocument;
    if (!doc?.head) {
      return () => undefined;
    }

    if (!doc.getElementById("codev-orca-theme")) {
      const link = doc.createElement("link");
      link.id = "codev-orca-theme";
      link.rel = "stylesheet";
      link.href = ORCA_THEME_OVERRIDE_HREF;
      doc.head.appendChild(link);
    }

    if (applyOrcaWorkspaceBranding(doc, workspaceName)) {
      return () => undefined;
    }
    if (!doc.body) {
      return () => undefined;
    }

    const observer = new MutationObserver(() => {
      if (applyOrcaWorkspaceBranding(doc, workspaceName)) {
        stopWatching();
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    const timeout = setTimeout(stopWatching, 10_000);

    function stopWatching() {
      observer.disconnect();
      clearTimeout(timeout);
    }

    return stopWatching;
  } catch {
    // Same-origin injection is best-effort; stock Orca colors are fine as fallback.
    return () => undefined;
  }
}

const ADD_PROJECT_BUTTON_SELECTOR = 'button[aria-label="Add Project"]';
const HOST_SELECTOR = '[role="combobox"]';
const OPTION_SELECTOR = '[role="option"]';
const DIALOG_SELECTOR = '[role="dialog"]';
const PATH_INPUT_SELECTOR = 'input[placeholder*="enter a path" i]';
const LISTING_ENTRY_NAME_SELECTOR = "button span.truncate.flex-1.min-w-0";
const AUTO_ADD_PROJECT_TIMEOUT_MS = 25_000;
const EMPTY_STATE_TIMEOUT_MS = 20_000;
const NAVIGATION_STEP_TIMEOUT_MS = 6_000;

function findAddProjectButton(doc: Document): HTMLButtonElement | null {
  return (
    doc.querySelector<HTMLButtonElement>(ADD_PROJECT_BUTTON_SELECTOR) ??
    findButtonByText(doc.body, /^\s*add project\s*$/i)
  );
}

function isOrcaShowingEmptyProjectState(doc: Document): boolean {
  return Array.from(doc.querySelectorAll("h1, h2, p, span")).some((node) =>
    /add a project to get started/i.test(node.textContent ?? ""),
  );
}

function findButtonByText(
  root: ParentNode,
  pattern: RegExp,
): HTMLButtonElement | null {
  return (
    Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => pattern.test(button.textContent ?? ""),
    ) ?? null
  );
}

/**
 * The lone breadcrumb segment button rendered with the literal text "/" for
 * the filesystem root. Unlike every other breadcrumb segment and listing
 * row (which wrap an icon or a name `<span>`), it has no child elements, so
 * an exact-text-with-no-children check disambiguates it from unrelated
 * buttons that might also read "/".
 */
function findRootBreadcrumbButton(root: ParentNode): HTMLButtonElement | null {
  return (
    Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) =>
        button.children.length === 0 && button.textContent?.trim() === "/",
    ) ?? null
  );
}

/**
 * A directory/file row in Orca's filesystem browser listing, matched by its
 * exact visible name. Listing rows render the name inside a dedicated
 * `<span>` (as opposed to breadcrumb segments, which are plain-text
 * buttons), so this can't accidentally match a breadcrumb.
 */
function findListingEntryButton(
  doc: Document,
  name: string,
): HTMLButtonElement | null {
  const nameSpan = Array.from(
    doc.querySelectorAll<HTMLSpanElement>(LISTING_ENTRY_NAME_SELECTOR),
  ).find((span) => span.textContent?.trim() === name);
  return nameSpan?.closest("button") ?? null;
}

async function waitFor<T>(
  win: Window,
  find: () => T | null | undefined,
  { timeoutMs, intervalMs = 150 }: { timeoutMs: number; intervalMs?: number },
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = find();
    if (found) {
      return found;
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the Orca project dialog.");
    }
    await new Promise((resolve) => win.setTimeout(resolve, intervalMs));
  }
}

/**
 * Best-effort automation of Orca's own "Add a project" dialog so the
 * workspace repository CoDev already cloned onto this workspace's own
 * dedicated Orca IDE process (see `ensureOrcaSession` in
 * `apps/web/lib/orca-host.ts`) opens automatically instead of leaving the
 * user stuck at Orca's empty "Add a project to get started" state.
 *
 * This drives the real, unmodified UI a person would click through (host
 * picker -> Browse folder -> navigate to the directory -> Select folder)
 * rather than reaching for Orca's internal store/RPC calls, which aren't
 * reachable from outside the vendored bundle. Any missing/renamed selector
 * just aborts silently and leaves the manual "Add Project" flow as the
 * fallback. Re-check selectors after any Orca version bump (see
 * third_party/orca/UPSTREAM.md).
 *
 * The dialog's path field is a *filter* over the current directory's
 * listing, not an absolute-path navigator — typing the full cloned path
 * into it directly resolves nothing and silently leaves the browser on
 * whatever directory it started in. So instead this clicks through the
 * breadcrumb to the filesystem root, then clicks into each path segment's
 * listing row in turn (filtering the listing by name first to find it),
 * mirroring how a person would navigate the picker by hand.
 *
 * `onWillAutomate` fires once, right before the dialog is opened, so a
 * caller can hide the iframe for the (sub-second) duration of the
 * automation instead of visibly flashing through Orca's own dialog.
 */
export async function autoAddOrcaProject(
  doc: Document,
  workspacePath: string,
  {
    timeoutMs = AUTO_ADD_PROJECT_TIMEOUT_MS,
    emptyStateTimeoutMs = EMPTY_STATE_TIMEOUT_MS,
    navigationStepTimeoutMs = NAVIGATION_STEP_TIMEOUT_MS,
    onWillAutomate,
  }: {
    timeoutMs?: number;
    emptyStateTimeoutMs?: number;
    navigationStepTimeoutMs?: number;
    onWillAutomate?: () => void;
  } = {},
): Promise<boolean> {
  const win = doc.defaultView;
  if (!win) {
    return false;
  }

  try {
    // The iframe's `load` event fires as soon as its scripts finish
    // executing, well before Orca's React app has rendered anything (it
    // still has to boot and negotiate the pairing connection). Poll for the
    // toolbar's "Add Project" button as a boot signal instead of checking
    // once for the empty state, which would otherwise race an empty DOM.
    const addProjectButton = await waitFor(
      win,
      () => findAddProjectButton(doc),
      {
        timeoutMs: emptyStateTimeoutMs,
      },
    );
    if (!isOrcaShowingEmptyProjectState(doc)) {
      // A project is already open; nothing to do.
      return false;
    }
    onWillAutomate?.();
    addProjectButton.click();

    const dialog = await waitFor(
      win,
      () => doc.querySelector<HTMLElement>(DIALOG_SELECTOR),
      { timeoutMs },
    );

    const hostTrigger = dialog.querySelector<HTMLElement>(HOST_SELECTOR);
    if (hostTrigger && !/connected/i.test(hostTrigger.textContent ?? "")) {
      hostTrigger.click();
      const connectedOption = await waitFor(
        win,
        () =>
          Array.from(doc.querySelectorAll<HTMLElement>(OPTION_SELECTOR)).find(
            (option) => /connected/i.test(option.textContent ?? ""),
          ) ?? null,
        { timeoutMs },
      );
      connectedOption.click();
    }

    const browseFolderButton = await waitFor(
      win,
      () => findButtonByText(dialog, /browse folder/i),
      { timeoutMs },
    );
    browseFolderButton.click();

    const rootBreadcrumbButton = await waitFor(
      win,
      () => findRootBreadcrumbButton(dialog),
      { timeoutMs: navigationStepTimeoutMs },
    );
    rootBreadcrumbButton.click();

    const setNativeValue = Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      "value",
    )?.set;
    const segments = workspacePath.split("/").filter(Boolean);
    for (const segment of segments) {
      const filterInput = await waitFor(
        win,
        () => doc.querySelector<HTMLInputElement>(PATH_INPUT_SELECTOR),
        { timeoutMs: navigationStepTimeoutMs },
      );
      setNativeValue?.call(filterInput, segment);
      filterInput.dispatchEvent(new win.Event("input", { bubbles: true }));

      const entryButton = await waitFor(
        win,
        () => findListingEntryButton(doc, segment),
        { timeoutMs: navigationStepTimeoutMs },
      );
      entryButton.click();
    }

    const selectFolderButton = await waitFor(
      win,
      () => {
        const button = findButtonByText(doc.body, /select folder/i);
        return button && !button.disabled ? button : null;
      },
      { timeoutMs: navigationStepTimeoutMs },
    );

    // Confirm the browser actually landed on the exact directory we
    // navigated to before handing off — Orca surfaces the resolved path as
    // this button's `title`. Never click through on a mismatch: that's
    // exactly how an earlier version of this function ended up silently
    // confirming a fallback directory instead of the cloned repo.
    if (selectFolderButton.getAttribute("title") !== workspacePath) {
      return false;
    }
    selectFolderButton.click();

    // For a path that resolves to an existing git repository, Orca shows a
    // second confirmation step ("Add Git Project" / "Open as Folder") before
    // it actually registers the project.
    const confirmButton = await waitFor(
      win,
      () =>
        findButtonByText(doc.body, /add git project/i) ??
        findButtonByText(doc.body, /open as folder/i),
      { timeoutMs },
    );
    confirmButton.click();
    return true;
  } catch {
    return false;
  }
}

export function WorkspaceTopBar({
  repository,
  workspaceId,
  canInvite,
  liveAgentCount = null,
}: {
  repository: string | null;
  workspaceId: string;
  canInvite: boolean;
  liveAgentCount?: number | null;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const liveLabel =
    liveAgentCount == null
      ? `${MAX_PARALLEL_AGENT_SESSIONS} agent worktree slots`
      : `${liveAgentCount} of ${MAX_PARALLEL_AGENT_SESSIONS} agents live`;

  return (
    <header className="workspace-topbar">
      <Link href="/dashboard" className="workspace-topbar-home">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M9.5 3 5 8l4.5 5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        CoDev
      </Link>
      {repository ? (
        <span className="workspace-topbar-repo">{repository}</span>
      ) : null}
      <div className="workspace-topbar-actions">
        <span
          className={`workspace-topbar-capacity${liveAgentCount ? " is-live" : ""}`}
          aria-label={
            liveAgentCount == null
              ? `Agent worktree capacity: ${MAX_PARALLEL_AGENT_SESSIONS} slots`
              : `Active agents: ${liveAgentCount} of ${MAX_PARALLEL_AGENT_SESSIONS} live`
          }
        >
          {liveLabel}
        </span>
        <button
          className="workspace-topbar-share"
          type="button"
          onClick={() => setShareOpen(true)}
        >
          <Share2 aria-hidden size={13} />
          Share
        </button>
      </div>
      <WorkspaceShareDialog
        canInvite={canInvite}
        onClose={() => setShareOpen(false)}
        open={shareOpen}
        workspaceId={workspaceId}
      />
    </header>
  );
}

function WorkspaceChrome({
  repository,
  workspaceId,
  canInvite,
  children,
}: {
  repository: string | null;
  workspaceId: string;
  canInvite: boolean;
  children: ReactNode;
}) {
  const activity = useLiveAgentActivity(workspaceId);

  return (
    <div className="workspace-page">
      <WorkspaceTopBar
        canInvite={canInvite}
        liveAgentCount={activity?.occupied ?? null}
        repository={repository}
        workspaceId={workspaceId}
      />
      <div className="workspace-body">
        {children}
        <WorkspaceAgentActivityRail
          cards={activity?.cards ?? emptyLiveAgentCards()}
          occupied={activity?.occupied ?? 0}
          max={activity?.max ?? MAX_PARALLEL_AGENT_SESSIONS}
        />
      </div>
    </div>
  );
}

/**
 * Full-viewport host for the vendored Orca web client. Fetches the runtime
 * pairing offer from the CoDev backend, then boots the unmodified Orca web
 * bundle in an iframe via its `#pairing=` startup fragment.
 */
export function OrcaWorkspace({
  workspaceId,
  repository,
  canInvite,
}: {
  workspaceId: string;
  repository: string | null;
  canInvite: boolean;
}) {
  const [connection, setConnection] = useState<ConnectionPhase>({
    phase: "connecting",
  });
  const [attempt, setAttempt] = useState(0);
  const [isOpeningProject, setIsOpeningProject] = useState(false);
  const [repositoryDialogOpen, setRepositoryDialogOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const disposeIframeBranding = useRef<(() => void) | null>(null);
  const codevBridgeSessionRef = useRef<CodevParentBridgeSession>(
    EMPTY_CODEV_PARENT_BRIDGE_SESSION,
  );

  useEffect(() => {
    return () => {
      disposeIframeBranding.current?.();
    };
  }, []);

  useEffect(() => {
    function receiveOrcaMessage(event: MessageEvent<CodevOrcaMessage>) {
      if (
        event.origin !== window.location.origin ||
        event.source !== iframeRef.current?.contentWindow ||
        !event.data ||
        typeof event.data !== "object"
      ) {
        return;
      }
      if (isCodevBridgeClientMessage(event.data)) {
        const { session, reply } = replyToCodevBridgeMessage(
          codevBridgeSessionRef.current,
          event.data,
        );
        codevBridgeSessionRef.current = session;
        if (reply) {
          iframeRef.current?.contentWindow?.postMessage(
            reply,
            window.location.origin,
          );
        }
        return;
      }
      if (isCodevBridgeRequestMessage(event.data)) {
        void executeCodevBridgeRequest(
          workspaceId,
          event.data,
          codevBridgeSessionRef.current,
        ).then((reply) => {
          iframeRef.current?.contentWindow?.postMessage(
            reply,
            window.location.origin,
          );
        });
        return;
      }
      if (event.data.type === "codev:choose-repository") {
        setRepositoryDialogOpen(true);
      } else if (
        event.data.type === "codev:discard-proposal" &&
        typeof event.data.requestId === "string" &&
        typeof event.data.worktreeId === "string"
      ) {
        const { requestId, worktreeId } = event.data;
        void discardOrcaManagedProposal(workspaceId, worktreeId).then(
          (result) => {
            iframeRef.current?.contentWindow?.postMessage(
              {
                type: "codev:proposal-discard-result",
                requestId,
                ...result,
              },
              window.location.origin,
            );
          },
        );
      } else if (
        event.data.type === "codev:create-proposal" &&
        typeof event.data.requestId === "string"
      ) {
        const { requestId } = event.data;
        void createOrcaManagedProposal(workspaceId).then((result) => {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "codev:proposal-create-result",
              requestId,
              ...result,
            },
            window.location.origin,
          );
        });
      } else if (event.data.type === "codev:project-ready") {
        setIsOpeningProject(false);
      } else if (event.data.type === "codev:project-error") {
        setIsOpeningProject(false);
        setConnection({
          phase: "error",
          message:
            event.data.message || "The workspace project could not be opened.",
        });
      }
    }

    window.addEventListener("message", receiveOrcaMessage);
    return () => window.removeEventListener("message", receiveOrcaMessage);
  }, [workspaceId]);

  const retry = useCallback(() => {
    setConnection({ phase: "connecting" });
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/orca`, {
          method: "POST",
        });
        const payload = (await response
          .json()
          .catch(() => null)) as OrcaConnectResponse | null;
        if (cancelled) {
          return;
        }
        if (response.status === 202) {
          setConnection({ phase: "host-starting" });
          retryTimer = setTimeout(() => {
            setAttempt((current) => current + 1);
          }, HOST_STARTING_RETRY_MS);
          return;
        }
        if (!response.ok || !payload?.pairingCode || !payload.webClientPath) {
          setConnection({
            phase: "error",
            message:
              payload?.error || "The workspace runtime could not be reached.",
          });
          return;
        }
        const workspacePath = payload.workspacePath;
        if (!workspacePath) {
          setConnection({
            phase: "error",
            message: "The workspace runtime did not return a project path.",
          });
          return;
        }
        setIsOpeningProject(true);
        setConnection({
          phase: "ready",
          iframeSrc: buildOrcaIframeSource({
            webClientPath: payload.webClientPath,
            pairingCode: payload.pairingCode,
            workspacePath,
            projectKind: repository ? "git" : "folder",
            ...(repository ? { projectName: repository } : {}),
          }),
          workspacePath,
        });
      } catch {
        if (!cancelled) {
          setConnection({
            phase: "error",
            message: "The workspace runtime could not be reached.",
          });
        }
      }
    }

    void connect();
    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [workspaceId, repository, attempt]);

  if (connection.phase === "ready") {
    return (
      <WorkspaceChrome
        canInvite={canInvite}
        repository={repository}
        workspaceId={workspaceId}
      >
        <div className="workspace-iframe-wrap">
          <iframe
            ref={iframeRef}
            className="workspace-iframe"
            src={connection.iframeSrc}
            title={repository ? `CoDev — ${repository}` : "CoDev workspace"}
            allow="clipboard-read; clipboard-write"
            onLoad={(event) => {
              disposeIframeBranding.current?.();
              disposeIframeBranding.current = injectOrcaThemeAndBranding(
                event.currentTarget,
                repository || "Workspace",
              );
            }}
          />
          {isOpeningProject ? (
            <div className="workspace-iframe-loading" role="status">
              <span className="workspace-iframe-loading-spinner" />
              <p>Opening your project…</p>
            </div>
          ) : null}
        </div>
        <WorkspaceRepositoryDialog
          open={repositoryDialogOpen}
          onClose={() => setRepositoryDialogOpen(false)}
        />
      </WorkspaceChrome>
    );
  }

  return (
    <WorkspaceChrome
      canInvite={canInvite}
      repository={repository}
      workspaceId={workspaceId}
    >
      <main className="workspace-status">
        {connection.phase === "error" ? (
          <>
            <h1>Could not open the workspace</h1>
            <p>{connection.message}</p>
            <button
              type="button"
              className="workspace-status-retry"
              onClick={retry}
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <h1>
              {connection.phase === "host-starting"
                ? "Starting the cloud host…"
                : "Connecting to your workspace…"}
            </h1>
            <p>
              {connection.phase === "host-starting"
                ? "The AWS instance is booting. This can take a minute."
                : repository
                  ? `Preparing ${repository} in your CoDev workspace.`
                  : "Preparing your CoDev workspace."}
            </p>
          </>
        )}
      </main>
    </WorkspaceChrome>
  );
}

"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Share2 } from "lucide-react";
import { track } from "@vercel/analytics";

import {
  EMPTY_CODEV_PARENT_BRIDGE_SESSION,
  executeCodevBridgeRequest,
  isCodevBridgeClientMessage,
  isCodevBridgeRequestMessage,
  replyToCodevBridgeMessage,
  type CodevParentBridgeSession,
} from "@/components/codev-parent-bridge";
import { useLiveAgentActivity } from "@/components/workspace-agent-activity";
import { watchOrcaProjectTree } from "@/components/orca-project-tree";
import { WorkspaceRepositoryDialog } from "@/components/workspace-repository-dialog";
import { WorkspaceShareDialog } from "@/components/workspace-share-dialog";
import { MAX_PARALLEL_AGENT_SESSIONS } from "@codev/contracts";

type ConnectionPhase =
  | { phase: "connecting" }
  | { phase: "host-starting" }
  // The host is up and a pairing offer is in hand. The iframe is already
  // mounted (it booted from the static bundle the moment this component did),
  // so we hand it the pairing over `postMessage` rather than swapping its src.
  | { phase: "ready" }
  | { phase: "error"; message: string };

/** Late pairing details posted into the already-running iframe once the host
 *  answers. Mirrors the fragment `buildOrcaIframeSource` used to encode. */
type PendingPair = {
  pairingCode: string;
  workspacePath: string;
  memberId?: string;
};

/**
 * Poll fast while the host comes up. The wake path is idempotent and cheap
 * (a DescribeInstances plus, at most, one StartInstances), so a tight poll
 * buys a noticeably quicker hand-off the moment the instance is ready
 * without meaningfully more work on the server.
 */
const HOST_STARTING_RETRY_MS = 2_500;
/**
 * How long to keep waiting before admitting the wait is unusual. Anything
 * that resolves on its own - a cold boot, a capacity retry, an orchestrator
 * still starting its services - lands well inside this, so crossing it just
 * softens the copy rather than turning into an error.
 */
const SLOW_START_NOTICE_MS = 90_000;
/**
 * Keepalive cadence for an open IDE. Comfortably under the host's idle
 * window, and paused while the tab is hidden so a forgotten background tab
 * does not hold the instance open indefinitely.
 */
const IDE_KEEPALIVE_MS = 60_000;
/**
 * The only connect failures worth showing: signing in, being granted access,
 * a workspace that is gone, and running out of credit are all things the
 * person can do something about. Every other status is infrastructure and is
 * retried silently.
 */
const ACTIONABLE_CONNECT_STATUSES = new Set([401, 403, 404, 429]);
const ORCA_THEME_OVERRIDE_HREF = "/orca-theme-overrides.css";
const CODEV_EMPTY_STATE_LOGO_SRC = "/brand/codev-mark-v3.png";
/** The embedded IDE bundle. Served from this origin, so it is known and
 *  loadable before the workspace's EC2 host has finished waking. */
const ORCA_WEB_CLIENT_PATH = "/orca/web-index.html";
/**
 * How long to keep the loading skeleton up when the iframe never reports
 * `codev:shell-ready` (an older bundle, or a shell that failed to paint). By
 * this point the pairing has usually landed and the iframe is the real IDE, so
 * revealing it is the right call rather than skeletoning forever.
 */
const SHELL_READY_FALLBACK_MS = 8_000;

type OrcaConnectResponse = {
  state?: string;
  pairingCode?: string;
  webClientPath?: string;
  workspacePath?: string | null;
  memberId?: string;
  error?: string;
};

type CodevOrcaMessage =
  | { type: "codev:choose-repository" }
  | { type: "codev:shell-ready" }
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

/** Agent the embedded IDE opens the workspace's default chat tab with. */
export type OrcaDefaultAgent = "claude" | "codex";

export function buildOrcaIframeSource({
  webClientPath,
  pairingCode,
  workspacePath,
  projectKind,
  projectName,
  defaultAgent,
  memberId,
  settingsOnly,
  cursorAvailable,
}: {
  webClientPath: string;
  pairingCode: string;
  workspacePath: string;
  projectKind: "git" | "folder";
  projectName?: string;
  /** Pins which agent the workspace's default chat tab launches with. */
  defaultAgent?: OrcaDefaultAgent;
  /**
   * The signed-in member, so agents launched in this iframe run on their own
   * linked subscription rather than the one belonging to whichever member
   * started the shared session. An id, never a credential.
   */
  memberId?: string;
  /** Render the personal settings surface instead of the workspace IDE. */
  settingsOnly?: boolean;
  /** Whether this member has a linked Cursor credential — gates offering it
   *  in the IDE's in-chat provider switcher. */
  cursorAvailable?: boolean;
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
  if (defaultAgent) {
    fragment.set("codevDefaultAgent", defaultAgent);
  }
  if (memberId) {
    fragment.set("codevMemberId", memberId);
  }
  if (settingsOnly) {
    fragment.set("codevSettingsOnly", "1");
  }
  if (cursorAvailable) {
    fragment.set("codevCursorAvailable", "1");
  }
  return `${webClientPath}#${fragment.toString()}`;
}

/**
 * The iframe src used before the host is up: everything the client can know
 * from this origin, and `codevPending=1` so it renders the IDE shell now and
 * waits for the pairing + project path to arrive over `codev:pair`.
 */
export function buildOrcaPendingIframeSource({
  projectKind,
  projectName,
  defaultAgent,
  cursorAvailable,
}: {
  projectKind: "git" | "folder";
  projectName?: string;
  defaultAgent?: OrcaDefaultAgent;
  cursorAvailable?: boolean;
}) {
  const fragment = new URLSearchParams({
    codev: "1",
    codevPending: "1",
    codevProjectKind: projectKind,
  });
  if (projectName) {
    fragment.set("codevProjectName", projectName);
  }
  if (defaultAgent) {
    fragment.set("codevDefaultAgent", defaultAgent);
  }
  if (cursorAvailable) {
    fragment.set("codevCursorAvailable", "1");
  }
  return `${ORCA_WEB_CLIENT_PATH}#${fragment.toString()}`;
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

    const stopHidingProjectTree = watchOrcaProjectTree(doc);

    if (applyOrcaWorkspaceBranding(doc, workspaceName)) {
      return stopHidingProjectTree;
    }
    if (!doc.body) {
      return stopHidingProjectTree;
    }

    const observer = new MutationObserver(() => {
      if (applyOrcaWorkspaceBranding(doc, workspaceName)) {
        stopWatchingBranding();
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    const timeout = setTimeout(stopWatchingBranding, 10_000);

    function stopWatchingBranding() {
      observer.disconnect();
      clearTimeout(timeout);
    }

    return () => {
      stopWatchingBranding();
      stopHidingProjectTree();
    };
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
 * rather than reaching for the IDE's internal store/RPC calls, which aren't
 * reachable from outside the built bundle. Any missing/renamed selector
 * just aborts silently and leaves the manual "Add Project" flow as the
 * fallback. Re-check these selectors after UI changes in `packages/ide`
 * (see packages/ide/CODEV-INTEGRATION.md).
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
      {/* The workspace's team rail (people, status, channels) and its live
          agents both live inside the embedded IDE's own sidebars now — the
          team rail folded into Orca's left sidebar, live agents in its right
          one — so the parent page is just the top bar plus the IDE. The live
          count stays in the top bar so it is visible from here too. */}
      <div className="workspace-body">{children}</div>
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
  defaultAgent,
  cursorAvailable,
}: {
  workspaceId: string;
  repository: string | null;
  canInvite: boolean;
  defaultAgent?: OrcaDefaultAgent;
  /** Whether this member has a linked Cursor credential — gates offering it
   *  in the IDE's in-chat provider switcher. */
  cursorAvailable?: boolean;
}) {
  const [connection, setConnection] = useState<ConnectionPhase>({
    phase: "connecting",
  });
  const [attempt, setAttempt] = useState(0);
  const [isOpeningProject, setIsOpeningProject] = useState(false);
  const [isSlowStart, setIsSlowStart] = useState(false);
  // Seeded on the first effect run rather than during render: `Date.now()` is
  // impure, and the value only ever feeds the "this is taking a while" copy.
  const waitingSinceRef = useRef<number | null>(null);
  const [repositoryDialogOpen, setRepositoryDialogOpen] = useState(false);
  // The embedded IDE reports its chrome has painted; until then the loading
  // skeleton covers the iframe. `iframeKey` forces a fresh iframe load when a
  // reaped session has to be replaced under an open tab.
  const [shellReady, setShellReady] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const disposeIframeBranding = useRef<(() => void) | null>(null);
  // Held here (not in `connection`) so it survives the poll's state churn and
  // can be (re)delivered to the iframe on its next load.
  const pendingPairRef = useRef<PendingPair | null>(null);
  const codevBridgeSessionRef = useRef<CodevParentBridgeSession>(
    EMPTY_CODEV_PARENT_BRIDGE_SESSION,
  );

  // The iframe src never changes across a connect: it boots from the static
  // bundle immediately with `codevPending=1`, and the pairing arrives later
  // over `codev:pair`. Rebuilt only when the RSC-known project facts change.
  const pendingIframeSrc = useMemo(
    () =>
      buildOrcaPendingIframeSource({
        projectKind: repository ? "git" : "folder",
        ...(repository ? { projectName: repository } : {}),
        ...(defaultAgent ? { defaultAgent } : {}),
        ...(cursorAvailable ? { cursorAvailable } : {}),
      }),
    [repository, defaultAgent, cursorAvailable],
  );

  // Hand the pairing to the embedded IDE. Safe to call repeatedly and before
  // the pairing exists — it no-ops until both the pairing and a live iframe
  // window are in hand, so callers fire it from the poll and from `onLoad`.
  const deliverPairing = useCallback(() => {
    const pair = pendingPairRef.current;
    const target = iframeRef.current?.contentWindow;
    if (!pair || !target) {
      return;
    }
    target.postMessage(
      {
        type: "codev:pair",
        pairing: pair.pairingCode,
        projectPath: pair.workspacePath,
        projectKind: repository ? "git" : "folder",
        ...(repository ? { projectName: repository } : {}),
        ...(defaultAgent ? { defaultAgent } : {}),
        ...(pair.memberId ? { memberId: pair.memberId } : {}),
        ...(cursorAvailable ? { cursorAvailable } : {}),
      },
      window.location.origin,
    );
  }, [repository, defaultAgent, cursorAvailable]);

  // Time-to-shell / time-to-project, measured from this component's first
  // paint (which is when the iframe starts loading the static bundle).
  const bootStartRef = useRef<number | null>(null);
  const reportedRef = useRef({ shell: false, project: false });
  useEffect(() => {
    bootStartRef.current ??= performance.now();
    return () => {
      disposeIframeBranding.current?.();
    };
  }, []);
  const reportBootMark = useCallback(
    (event: "workspace_shell_ready" | "workspace_project_ready") => {
      const key = event === "workspace_shell_ready" ? "shell" : "project";
      if (reportedRef.current[key] || bootStartRef.current === null) {
        return;
      }
      reportedRef.current[key] = true;
      track(event, {
        ms: Math.round(performance.now() - bootStartRef.current),
      });
    },
    [],
  );

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
      } else if (event.data.type === "codev:shell-ready") {
        setShellReady(true);
        reportBootMark("workspace_shell_ready");
        // The pairing can already be sitting in pendingPairRef by the time the
        // shell announces itself (a warm host resolves the wake-poll almost
        // instantly, well before the iframe has loaded its bundle, mounted
        // React, and attached its own `message` listener) — a postMessage
        // sent before that listener exists is simply dropped, no error, no
        // retry, and the shell waits for a pairing that already came and went.
        // This is the one signal that proves the listener is actually up, so
        // deliver (or re-deliver) here regardless of what triggered delivery
        // before.
        deliverPairing();
      } else if (event.data.type === "codev:project-ready") {
        setIsOpeningProject(false);
        reportBootMark("workspace_project_ready");
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
  }, [workspaceId, reportBootMark, deliverPairing]);

  // Fallback reveal: if the iframe never sends `codev:shell-ready` (older
  // bundle, or a shell that failed to paint), stop covering it once the wait
  // has clearly outlasted a normal boot — by then it is the real IDE anyway.
  useEffect(() => {
    if (shellReady) {
      return;
    }
    const timer = setTimeout(
      () => setShellReady(true),
      SHELL_READY_FALLBACK_MS,
    );
    return () => clearTimeout(timer);
  }, [shellReady, iframeKey]);

  // Re-hand the pairing whenever we newly have one (the poll may resolve after
  // the iframe has already loaded, so `onLoad` alone is not enough).
  useEffect(() => {
    if (connection.phase === "ready") {
      deliverPairing();
    }
  }, [connection.phase, deliverPairing]);

  const retry = useCallback(() => {
    waitingSinceRef.current = null;
    setIsSlowStart(false);
    setShellReady(false);
    pendingPairRef.current = null;
    setIsOpeningProject(false);
    setIframeKey((current) => current + 1);
    setConnection({ phase: "connecting" });
    setAttempt((current) => current + 1);
  }, []);

  /**
   * Hold the IDE session open while this tab is actually being looked at.
   * The Orca client connects straight to the host, so without this the
   * orchestrator sees a session in constant use as completely idle and reaps
   * it - and then powers the host down - mid-session.
   */
  useEffect(() => {
    if (connection.phase !== "ready") {
      return;
    }
    let cancelled = false;
    async function sendKeepalive() {
      if (cancelled || document.visibilityState !== "visible") {
        return;
      }
      try {
        const response = await fetch(
          `/api/workspaces/${workspaceId}/orca/activity`,
          { method: "POST", keepalive: true },
        );
        const payload = (await response.json().catch(() => null)) as {
          session?: string;
        } | null;
        // The session this iframe is bound to no longer exists - the host was
        // stopped or replaced under an open tab, or the session was reaped.
        // The embedded IDE is dead and will not recover on its own, so go
        // back through the connect path and get a fresh one rather than
        // leaving somebody staring at a blank pane.
        if (!cancelled && payload?.session === "gone") {
          setIsOpeningProject(false);
          setShellReady(false);
          pendingPairRef.current = null;
          setIframeKey((current) => current + 1);
          setConnection({ phase: "connecting" });
          setAttempt((current) => current + 1);
        }
      } catch {
        // Transient: the next keepalive covers it.
      }
    }
    void sendKeepalive();
    const onTick = () => void sendKeepalive();
    const timer = setInterval(onTick, IDE_KEEPALIVE_MS);
    document.addEventListener("visibilitychange", onTick);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onTick);
    };
  }, [connection.phase, workspaceId]);

  useEffect(() => {
    if (connection.phase === "ready" || connection.phase === "error") {
      return;
    }
    waitingSinceRef.current ??= Date.now();
    const timer = setInterval(() => {
      const since = waitingSinceRef.current;
      setIsSlowStart(
        since !== null && Date.now() - since >= SLOW_START_NOTICE_MS,
      );
    }, 5_000);
    return () => clearInterval(timer);
  }, [connection.phase]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Everything that is not the person's own problem - a stopped host, a
     * capacity refusal, an orchestrator still booting, a dropped request -
     * keeps polling behind the ordinary starting state. Only the statuses
     * they can actually act on (sign in, ask for access, missing workspace,
     * quota) become an error screen.
     */
    function waitAndRetry() {
      setConnection({ phase: "host-starting" });
      retryTimer = setTimeout(() => {
        setAttempt((current) => current + 1);
      }, HOST_STARTING_RETRY_MS);
    }

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
          waitAndRetry();
          return;
        }
        if (ACTIONABLE_CONNECT_STATUSES.has(response.status)) {
          setConnection({
            phase: "error",
            message:
              payload?.error || "The workspace runtime could not be reached.",
          });
          return;
        }
        if (!response.ok || !payload?.pairingCode || !payload.webClientPath) {
          waitAndRetry();
          return;
        }
        const workspacePath = payload.workspacePath;
        if (!workspacePath) {
          waitAndRetry();
          return;
        }
        // The iframe is already running the pending shell — hand it the
        // pairing rather than reloading it. `deliverPairing` fires from the
        // effect keyed on this phase change (and again from `onLoad`).
        pendingPairRef.current = {
          pairingCode: payload.pairingCode,
          workspacePath,
          ...(payload.memberId ? { memberId: payload.memberId } : {}),
        };
        setIsOpeningProject(true);
        setConnection({ phase: "ready" });
      } catch {
        if (!cancelled) {
          waitAndRetry();
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
  }, [workspaceId, repository, attempt, defaultAgent, cursorAvailable]);

  if (connection.phase === "error") {
    return (
      <WorkspaceChrome
        canInvite={canInvite}
        repository={repository}
        workspaceId={workspaceId}
      >
        <main className="workspace-status">
          <h1>Could not open the workspace</h1>
          <p>{connection.message}</p>
          <button
            type="button"
            className="workspace-status-retry"
            onClick={retry}
          >
            Retry
          </button>
        </main>
      </WorkspaceChrome>
    );
  }

  // The iframe boots from the static bundle the moment this component mounts,
  // so the IDE chrome paints while the host is still waking. An IDE-shaped
  // skeleton covers it until `codev:shell-ready`; after that a small pill in
  // the corner reports host-wake / project-open progress non-blockingly.
  const hostReady = connection.phase === "ready";
  return (
    <WorkspaceChrome
      canInvite={canInvite}
      repository={repository}
      workspaceId={workspaceId}
    >
      <div className="workspace-iframe-wrap">
        <iframe
          key={iframeKey}
          ref={iframeRef}
          className="workspace-iframe"
          src={pendingIframeSrc}
          title={repository ? `CoDev — ${repository}` : "CoDev workspace"}
          allow="clipboard-read; clipboard-write"
          onLoad={(event) => {
            disposeIframeBranding.current?.();
            disposeIframeBranding.current = injectOrcaThemeAndBranding(
              event.currentTarget,
              repository || "Workspace",
            );
            deliverPairing();
          }}
        />
        {shellReady ? null : (
          <div
            className="workspace-boot workspace-boot-overlay"
            role="status"
            aria-live="polite"
          >
            <div className="workspace-boot-skeleton" aria-hidden="true">
              <div className="workspace-boot-rail" />
              <div className="workspace-boot-main">
                <div className="workspace-boot-bar" style={{ width: "38%" }} />
                <div className="workspace-boot-bar" style={{ width: "72%" }} />
                <div className="workspace-boot-bar" style={{ width: "54%" }} />
                <div className="workspace-boot-block" />
              </div>
              <div className="workspace-boot-rail workspace-boot-rail-right" />
            </div>
            <p className="workspace-boot-note">
              {isSlowStart
                ? "Still starting — this one is taking longer than usual. It will open on its own."
                : repository
                  ? `Starting ${repository}…`
                  : "Starting your workspace…"}
            </p>
          </div>
        )}
        {shellReady && !hostReady ? (
          <div className="workspace-boot-pill" role="status">
            <span className="workspace-boot-pill-dot" />
            {isSlowStart
              ? "Still starting the workspace…"
              : repository
                ? `Starting ${repository}…`
                : "Starting your workspace…"}
            {isSlowStart ? (
              <button
                type="button"
                className="workspace-boot-pill-retry"
                onClick={retry}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
        {shellReady && hostReady && isOpeningProject ? (
          <div className="workspace-boot-pill" role="status">
            <span className="workspace-boot-pill-dot is-live" />
            Opening project…
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

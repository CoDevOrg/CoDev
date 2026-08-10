"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

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
      () => doc.querySelector<HTMLButtonElement>(ADD_PROJECT_BUTTON_SELECTOR),
      { timeoutMs: emptyStateTimeoutMs },
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

function WorkspaceTopBar({ repository }: { repository: string | null }) {
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
    </header>
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
}: {
  workspaceId: string;
  repository: string | null;
}) {
  const [connection, setConnection] = useState<ConnectionPhase>({
    phase: "connecting",
  });
  const [attempt, setAttempt] = useState(0);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const disposeIframeBranding = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      disposeIframeBranding.current?.();
    };
  }, []);

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
        setConnection({
          phase: "ready",
          iframeSrc: `${payload.webClientPath}#pairing=${encodeURIComponent(payload.pairingCode)}`,
          workspacePath: payload.workspacePath ?? null,
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
  }, [workspaceId, attempt]);

  if (connection.phase === "ready") {
    return (
      <div className="workspace-page">
        <WorkspaceTopBar repository={repository} />
        <div className="workspace-iframe-wrap">
          <iframe
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
              const { workspacePath } = connection;
              const doc = event.currentTarget.contentDocument;
              if (workspacePath && doc) {
                void autoAddOrcaProject(doc, workspacePath, {
                  // Only cover the IDE for the automation itself — Orca's
                  // own (usually sub-second) boot/pairing sequence stays
                  // visible as normal.
                  onWillAutomate: () => setIsAddingProject(true),
                }).finally(() => setIsAddingProject(false));
              }
            }}
          />
          {isAddingProject ? (
            <div className="workspace-iframe-loading" role="status">
              <span className="workspace-iframe-loading-spinner" />
              <p>Opening your project…</p>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <WorkspaceTopBar repository={repository} />
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
    </div>
  );
}

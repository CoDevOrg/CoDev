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
          }}
        />
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

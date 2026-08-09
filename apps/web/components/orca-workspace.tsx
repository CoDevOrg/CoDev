"use client";

import { useCallback, useEffect, useState } from "react";

type ConnectionPhase =
  | { phase: "connecting" }
  | { phase: "host-starting" }
  | { phase: "ready"; iframeSrc: string; workspacePath: string | null }
  | { phase: "error"; message: string };

const HOST_STARTING_RETRY_MS = 8_000;
const ORCA_THEME_OVERRIDE_HREF = "/orca-theme-overrides.css";

type OrcaConnectResponse = {
  state?: string;
  pairingCode?: string;
  webClientPath?: string;
  workspacePath?: string | null;
  error?: string;
};

function injectOrcaThemeOverrides(iframe: HTMLIFrameElement) {
  try {
    const doc = iframe.contentDocument;
    if (!doc?.head) {
      return;
    }
    if (doc.getElementById("codev-orca-theme")) {
      return;
    }
    const link = doc.createElement("link");
    link.id = "codev-orca-theme";
    link.rel = "stylesheet";
    link.href = ORCA_THEME_OVERRIDE_HREF;
    doc.head.appendChild(link);
  } catch {
    // Same-origin injection is best-effort; stock Orca colors are fine as fallback.
  }
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
        <iframe
          className="workspace-iframe"
          src={connection.iframeSrc}
          title={repository ? `CoDev — ${repository}` : "CoDev workspace"}
          allow="clipboard-read; clipboard-write"
          onLoad={(event) => {
            injectOrcaThemeOverrides(event.currentTarget);
          }}
        />
      </div>
    );
  }

  return (
    <div className="workspace-page">
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

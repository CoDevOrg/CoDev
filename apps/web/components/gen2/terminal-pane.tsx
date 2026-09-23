"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

/**
 * A shell on the workspace's own machine.
 *
 * The orchestrator has no WebSocket, so output arrives by long poll: each
 * request parks in the guest for up to 20s and returns whatever appeared.
 * Polling stops when the pane is hidden. Empty long-polls are transport, not
 * user activity, so an open but idle terminal cannot keep its VM alive.
 */
export function Gen2TerminalPane({
  workspaceId,
  visible,
  canStart,
  onExit,
  onResumeWorkspace,
}: {
  workspaceId: string;
  visible: boolean;
  canStart: boolean;
  onExit: () => void;
  onResumeWorkspace: () => Promise<boolean>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const afterRef = useRef(0);
  const [status, setStatus] = useState<"idle" | "starting" | "live" | "ended">(
    "idle",
  );
  const [error, setError] = useState("");
  const [workspacePaused, setWorkspacePaused] = useState(false);

  const markWorkspacePaused = useCallback(() => {
    sessionRef.current = null;
    setWorkspacePaused(true);
    setError("The terminal disconnected when the workspace stopped.");
    setStatus("ended");
  }, []);

  const post = useCallback(
    (body: unknown) =>
      fetch(`/api/gen2/workspaces/${workspaceId}/terminal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    [workspaceId],
  );

  const start = useCallback(async () => {
    const host = hostRef.current;
    if (!host || sessionRef.current) return;
    setStatus("starting");
    setError("");
    setWorkspacePaused(false);

    const [{ Terminal: XTerm }, { FitAddon: Fit }] = await Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
    ]);
    await import("@xterm/xterm/css/xterm.css");

    const term = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
      fontSize: 12.5,
      theme: { background: "#00000000", foreground: "#e8e6e3" },
      allowTransparency: true,
    });
    const fit = new Fit();
    term.loadAddon(fit);
    term.open(host);
    if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    try {
      const response = await post({
        action: "start",
        rows: term.rows,
        columns: term.cols,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        sessionId?: string;
        error?: string;
      };
      if (!response.ok || !payload.sessionId) {
        if ([404, 502, 503].includes(response.status)) {
          markWorkspacePaused();
          return;
        }
        setError(payload.error ?? "The terminal could not start.");
        setStatus("idle");
        return;
      }
      sessionRef.current = payload.sessionId;
      afterRef.current = 0;
      setStatus("live");
      term.onData((data) => {
        void post({ action: "input", sessionId: payload.sessionId, data })
          .then((inputResponse) => {
            if ([404, 502, 503].includes(inputResponse.status)) {
              markWorkspacePaused();
            }
          })
          .catch(markWorkspacePaused);
      });
    } catch {
      setError("Couldn't reach CoDev. Try again.");
      setStatus("idle");
    }
  }, [markWorkspacePaused, post]);

  // Long-poll loop. Restarted whenever the pane becomes visible again.
  useEffect(() => {
    if (status !== "live" || !visible) return;
    let cancelled = false;
    let backoff = 1_000;
    let networkFailures = 0;

    async function pump() {
      while (!cancelled) {
        const sessionId = sessionRef.current;
        if (!sessionId) return;
        try {
          const response = await post({
            action: "poll",
            sessionId,
            after: afterRef.current,
          });
          if (cancelled) return;
          if (!response.ok) {
            if ([404, 502, 503].includes(response.status)) {
              markWorkspacePaused();
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, backoff));
            backoff = Math.min(backoff * 2, 15_000);
            continue;
          }
          networkFailures = 0;
          backoff = 1_000;
          const result = (await response.json()) as {
            chunks: { sequence: number; data: string }[];
            nextSequence: number;
            exited: boolean;
          };
          for (const chunk of result.chunks) termRef.current?.write(chunk.data);
          afterRef.current = result.nextSequence;
          if (result.exited) {
            setStatus("ended");
            sessionRef.current = null;
            onExit();
            return;
          }
        } catch {
          if (cancelled) return;
          networkFailures += 1;
          if (networkFailures >= 3) {
            markWorkspacePaused();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, backoff));
          backoff = Math.min(backoff * 2, 15_000);
        }
      }
    }

    void pump();
    return () => {
      cancelled = true;
    };
  }, [status, visible, post, onExit, markWorkspacePaused]);

  // Keep the PTY's idea of the viewport in step with the pane.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || status !== "live") return;
    let timer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const term = termRef.current;
        const sessionId = sessionRef.current;
        if (!term || !sessionId) return;
        // A hidden pane measures zero; fitting against that throws.
        if (host.clientWidth === 0 || host.clientHeight === 0) return;
        fitRef.current?.fit();
        void post({
          action: "resize",
          sessionId,
          rows: term.rows,
          columns: term.cols,
        });
      }, 120);
    });
    observer.observe(host);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [status, post]);

  useEffect(
    () => () => {
      const sessionId = sessionRef.current;
      if (sessionId) {
        void fetch(
          `/api/gen2/workspaces/${workspaceId}/terminal?sessionId=${sessionId}`,
          { method: "DELETE", keepalive: true },
        );
      }
      termRef.current?.dispose();
    },
    [workspaceId],
  );

  return (
    <div className="gen2-term">
      {workspacePaused ? (
        <div className="gen2-term-start">
          <p className="gen2-wb-banner gen2-wb-banner-error" role="alert">
            {error} Resume the workspace to reconnect.
          </p>
          <button
            type="button"
            className="gen2-wb-button"
            onClick={() => void onResumeWorkspace()}
          >
            Resume workspace
          </button>
        </div>
      ) : status === "idle" || status === "ended" ? (
        <div className="gen2-term-start">
          <button
            type="button"
            className="gen2-wb-button"
            onClick={() => void start()}
            disabled={!canStart}
            title={
              canStart
                ? undefined
                : "Opening a shell waits for Codex to finish its turn"
            }
          >
            {status === "ended" ? "Start a new terminal" : "Start terminal"}
          </button>
          {!canStart ? (
            <p className="gen2-wb-hint">
              Codex is working — a new shell can start once the turn ends.
            </p>
          ) : null}
          {error ? (
            <p className="gen2-wb-banner gen2-wb-banner-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      <div
        className="gen2-term-host"
        ref={hostRef}
        data-live={status === "live"}
      />
    </div>
  );
}

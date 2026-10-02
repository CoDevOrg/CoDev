"use client";

import { WorkspaceButton } from "./workspace-button";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

function cssVar(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function resolveTerminalTheme() {
  const surface = cssVar("--ws-surface-1", "#070c1a");
  const text = cssVar("--ws-text-primary", "#f2e9d6");
  const secondary = cssVar("--ws-text-secondary", "#96918a");
  const muted = cssVar("--ws-text-muted", "#726d64");
  const accent = cssVar("--ws-accent", "#3d8fe0");
  const accentBright = cssVar("--brand-accent-bright", accent);
  const teal = cssVar("--brand-teal", "#3fae9c");
  const orange = cssVar("--brand-orange", "#e08a54");
  const violet = cssVar("--brand-violet", "#a08cf0");
  const destructive = cssVar("--brand-destructive", "#e0574a");
  const selection = cssVar("--ws-accent-soft", "rgba(61, 143, 224, 0.28)");
  return {
    background: surface,
    foreground: text,
    cursor: accent,
    cursorAccent: surface,
    selectionBackground: selection,
    selectionForeground: text,
    selectionInactiveBackground: selection,
    black: muted,
    red: destructive,
    green: teal,
    yellow: orange,
    blue: accent,
    magenta: violet,
    cyan: accentBright,
    white: secondary,
    brightBlack: secondary,
    brightRed: destructive,
    brightGreen: teal,
    brightYellow: orange,
    brightBlue: accentBright,
    brightMagenta: violet,
    brightCyan: accentBright,
    brightWhite: text,
  };
}

/**
 * A shell on the workspace's own machine.
 *
 * The orchestrator has no WebSocket. Legacy guests long-poll; the Superset
 * bridge returns snapshots. Polling stops when hidden, and empty polls do
 * not count as workspace activity.
 */
export function Gen2TerminalPane({
  workspaceId,
  worktreeId = "main",
  visible,
  canStart,
  autoStart = false,
  onExit,
  onResumeWorkspace,
}: {
  workspaceId: string;
  worktreeId?: string | undefined;
  visible: boolean;
  canStart: boolean;
  autoStart?: boolean | undefined;
  onExit: () => void;
  onResumeWorkspace?: (() => Promise<boolean>) | undefined;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const afterRef = useRef(0);
  const dimensionsRef = useRef("");
  const wakePumpRef = useRef<(() => void) | null>(null);
  const lastTypedAtRef = useRef(0);
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
    (body: Record<string, unknown>) =>
      fetch(`/api/gen2/workspaces/${workspaceId}/terminal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, worktreeId }),
      }),
    [workspaceId, worktreeId],
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

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const term = new XTerm({
      convertEol: true,
      cursorBlink: !reduceMotion,
      cursorStyle: "bar",
      cursorInactiveStyle: "bar",
      cursorWidth: 2,
      fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
      fontSize: 13,
      fontWeight: 400,
      fontWeightBold: 600,
      lineHeight: 1.6,
      scrollback: 5000,
      smoothScrollDuration: reduceMotion ? 0 : 80,
      theme: resolveTerminalTheme(),
    });
    const fit = new Fit();
    term.loadAddon(fit);
    term.open(host);
    if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
    dimensionsRef.current = `${term.rows}:${term.cols}`;
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
      const sessionId = payload.sessionId;
      sessionRef.current = sessionId;
      afterRef.current = 0;
      setStatus("live");
      let pendingInput = "";
      let sending = false;
      const flushInput = async () => {
        if (sending) return;
        sending = true;
        try {
          while (pendingInput && sessionRef.current === sessionId) {
            let end = Math.min(pendingInput.length, 8_192);
            if (
              end < pendingInput.length &&
              /[\uD800-\uDBFF]/.test(pendingInput[end - 1] ?? "")
            )
              end--;
            const data = pendingInput.slice(0, end);
            pendingInput = pendingInput.slice(end);
            const response = await post({ action: "input", sessionId, data });
            if ([404, 502, 503].includes(response.status)) {
              markWorkspacePaused();
              return;
            }
            wakePumpRef.current?.();
          }
        } catch {
          markWorkspacePaused();
        } finally {
          sending = false;
        }
      };
      term.onData((data) => {
        lastTypedAtRef.current = Date.now();
        wakePumpRef.current?.();
        pendingInput += data;
        void flushInput();
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
          // The legacy guest endpoint parks this request, while the Superset
          // bridge returns an immediate snapshot. Yield between idle snapshots
          // so an open shell cannot turn into a tight browser request loop.
          // When recently typing, poll with tight burst latency (15ms) and wake
          // immediately on keystroke input so echoes appear instantly.
          if (result.chunks.length === 0) {
            const isTypingBurst = Date.now() - lastTypedAtRef.current < 1_500;
            const sleepMs = isTypingBurst ? 15 : 150;
            await new Promise<void>((resolve) => {
              let timer: ReturnType<typeof setTimeout> | null = null;
              const wake = () => {
                if (timer) clearTimeout(timer);
                wakePumpRef.current = null;
                resolve();
              };
              wakePumpRef.current = wake;
              timer = setTimeout(wake, sleepMs);
            });
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
      wakePumpRef.current?.();
      wakePumpRef.current = null;
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
        const dimensions = `${term.rows}:${term.cols}`;
        if (dimensions === dimensionsRef.current) return;
        dimensionsRef.current = dimensions;
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

  useEffect(() => {
    const updateTheme = () => {
      const term = termRef.current;
      if (term && term.options) {
        term.options.theme = resolveTerminalTheme();
      }
    };

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", updateTheme);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", updateTheme);
    };
  }, []);

  useEffect(
    () => () => {
      const sessionId = sessionRef.current;
      if (sessionId) {
        void fetch(
          `/api/gen2/workspaces/${workspaceId}/terminal?sessionId=${sessionId}&worktreeId=${encodeURIComponent(worktreeId)}`,
          { method: "DELETE", keepalive: true },
        );
      }
      termRef.current?.dispose();
    },
    [workspaceId, worktreeId],
  );

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (
      autoStart &&
      visible &&
      canStart &&
      status === "idle" &&
      !autoStartedRef.current
    ) {
      autoStartedRef.current = true;
      void start();
    }
  }, [autoStart, visible, canStart, status, start]);

  const handleResume = useCallback(async () => {
    if (!onResumeWorkspace) return;
    const ok = await onResumeWorkspace();
    if (ok) {
      setWorkspacePaused(false);
      setError("");
      setStatus("idle");
      autoStartedRef.current = false;
      void start();
    }
  }, [onResumeWorkspace, start]);

  return (
    <div className="gen2-term">
      {workspacePaused ? (
        <div className="gen2-term-start">
          <p className="gen2-term-error" role="alert">
            {error} Reconnect to continue.
          </p>
          {onResumeWorkspace ? (
            <WorkspaceButton
              tone="secondary"
              type="button"
              onClick={() => void handleResume()}
            >
              Reconnect workspace
            </WorkspaceButton>
          ) : null}
        </div>
      ) : status === "starting" ||
        (autoStart && status === "idle" && !error) ? (
        <p className="gen2-term-status" role="status">
          Starting shell…
        </p>
      ) : status === "idle" || status === "ended" ? (
        <div className="gen2-term-start">
          <WorkspaceButton
            tone="secondary"
            type="button"
            onClick={() => void start()}
            disabled={!canStart}
            title={
              canStart
                ? undefined
                : "Opening a shell waits for Codex to finish its turn"
            }
          >
            {status === "ended" ? "Start a new terminal" : "Start terminal"}
          </WorkspaceButton>
          {!canStart ? (
            <p className="gen2-term-hint">
              Codex is working — a new shell can start once the turn ends.
            </p>
          ) : null}
          {error ? (
            <p className="gen2-term-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="gen2-term-host" data-live={status === "live"}>
        <div className="gen2-term-screen" ref={hostRef} />
      </div>
    </div>
  );
}

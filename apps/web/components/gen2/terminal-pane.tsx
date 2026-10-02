"use client";

/*
 * This component drives an imperative xterm instance and a WebSocket from
 * refs, and keeps "latest value" refs (`fooRef.current = foo`) so long-lived
 * listeners never close over stale props. The React Compiler lint rules below
 * flag that pattern even though every ref is only read inside event handlers
 * and effects, so they are disabled for this file rather than restructured.
 */
/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ITheme, Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import {
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  Eraser,
  RotateCcw,
  Search,
  X,
} from "lucide-react";

/**
 * A shell on the workspace's own machine.
 *
 * The orchestrator has no WebSocket, so output arrives by poll: each request
 * returns whatever appeared (the legacy guest parks it for up to 20s). Polling
 * stops when the pane is hidden. Empty polls are transport, not user
 * activity, so an open but idle terminal cannot keep its VM alive.
 *
 * The shell opens by itself the first time the pane is shown. The terminal
 * stays invisible behind a connecting state until the shell's first screen has
 * arrived and settled, so the prompt appears in one paint, not line by line.
 */

const THEME: ITheme = {
  background: "#0c0d10",
  foreground: "#e6e6e6",
  cursor: "#f2f2f2",
  cursorAccent: "#0c0d10",
  selectionBackground: "rgba(90, 166, 236, 0.38)",
  black: "#1d1f24",
  red: "#ff6b6b",
  green: "#7bd88f",
  yellow: "#f5c76a",
  blue: "#6cb0ff",
  magenta: "#c792ea",
  cyan: "#5ad4e6",
  white: "#d7dae0",
  brightBlack: "#6b7280",
  brightRed: "#ff8787",
  brightGreen: "#98e6a8",
  brightYellow: "#ffd98a",
  brightBlue: "#8cc4ff",
  brightMagenta: "#dab0f5",
  brightCyan: "#84e3f0",
  brightWhite: "#ffffff",
};

const FONT_FAMILY =
  '"SF Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

const FONT_SIZE_DEFAULT = 12;
const FONT_SIZE_MIN = 9;
const FONT_SIZE_MAX = 24;
const FONT_SIZE_KEY = "codev.gen2.terminal.fontSize";

const SEARCH_DECORATIONS = {
  matchBackground: "#3a4658",
  matchOverviewRuler: "#5aa6ec",
  activeMatchBackground: "#7a5f14",
  activeMatchBorder: "#f5c76a",
  activeMatchColorOverviewRuler: "#f5c76a",
};

function readFontSize() {
  try {
    const stored = Number(window.localStorage.getItem(FONT_SIZE_KEY));
    if (Number.isFinite(stored) && stored >= FONT_SIZE_MIN) {
      return Math.min(stored, FONT_SIZE_MAX);
    }
  } catch {
    // Storage can be blocked; the default is fine.
  }
  return FONT_SIZE_DEFAULT;
}

/** The contract caps one input at 64 KiB; stay well under it. */
const INPUT_CHUNK = 32 * 1_024;
const PAUSED_STATUSES = [404, 502, 503];
/** How long the first screen may keep arriving before it is shown. */
const REVEAL_SETTLE_MS = 100;
/** A shell that prints nothing at all is shown anyway after this long. */
const REVEAL_FALLBACK_MS = 1_500;

type XtermModules = {
  Terminal: typeof import("@xterm/xterm").Terminal;
  FitAddon: typeof import("@xterm/addon-fit").FitAddon;
  WebLinksAddon: typeof import("@xterm/addon-web-links").WebLinksAddon;
  SearchAddon: typeof import("@xterm/addon-search").SearchAddon;
  Unicode11Addon: typeof import("@xterm/addon-unicode11").Unicode11Addon;
  WebglAddon: typeof import("@xterm/addon-webgl").WebglAddon;
};

let xtermModules: Promise<XtermModules> | null = null;

/** Loaded once and cached; the pane preloads it so Start has nothing to wait on. */
function loadXterm(): Promise<XtermModules> {
  if (!xtermModules) {
    const loading = Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/addon-web-links"),
      import("@xterm/addon-search"),
      import("@xterm/addon-unicode11"),
      import("@xterm/addon-webgl"),
      import("@xterm/xterm/css/xterm.css"),
    ]).then(([xterm, fit, links, search, unicode, webgl]) => ({
      Terminal: xterm.Terminal,
      FitAddon: fit.FitAddon,
      WebLinksAddon: links.WebLinksAddon,
      SearchAddon: search.SearchAddon,
      Unicode11Addon: unicode.Unicode11Addon,
      WebglAddon: webgl.WebglAddon,
    }));
    loading.catch(() => {
      if (xtermModules === loading) xtermModules = null;
    });
    xtermModules = loading;
  }
  return xtermModules;
}

function isMac() {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/i.test(navigator.platform)
  );
}

/** Split without cutting a surrogate pair in half. */
function takeInputChunk(pending: string) {
  if (pending.length <= INPUT_CHUNK) return pending;
  let end = INPUT_CHUNK;
  const last = pending.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return pending.slice(0, end);
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    scratch.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(scratch);
    scratch.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    scratch.remove();
    return copied;
  }
}

export function Gen2TerminalPane({
  workspaceId,
  worktreeId = "main",
  visible,
  canStart,
  onExit,
  onResumeWorkspace,
}: {
  workspaceId: string;
  worktreeId?: string;
  visible: boolean;
  canStart: boolean;
  onExit: () => void;
  onResumeWorkspace?: () => Promise<boolean>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const openFindRef = useRef<() => void>(() => {});
  const zoomRef = useRef<(direction: -1 | 0 | 1) => void>(() => {});
  const sessionRef = useRef<string | null>(null);
  const afterRef = useRef(0);
  const dimensionsRef = useRef("");
  const startingRef = useRef(false);
  const autoStartedRef = useRef(false);
  const unmountedRef = useRef(false);
  const readyRef = useRef(false);
  const revealTimersRef = useRef<number[]>([]);
  const pendingInputRef = useRef("");
  const flushingRef = useRef(false);
  const wakeRef = useRef<(() => void) | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const lastActivityRef = useRef(0);
  const noticeTimerRef = useRef(0);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const [status, setStatus] = useState<"idle" | "starting" | "live" | "ended">(
    "idle",
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [workspacePaused, setWorkspacePaused] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  // Output and input ride a WebSocket when the server offers one; polling is
  // the fallback for anything that cannot open it.
  const [useSocket, setUseSocket] = useState(
    () => typeof WebSocket !== "undefined",
  );
  const [notice, setNotice] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findResults, setFindResults] = useState({ index: -1, count: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const post = useCallback(
    (body: Record<string, unknown>) =>
      fetch(`/api/gen2/workspaces/${workspaceId}/terminal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, worktreeId }),
      }),
    [workspaceId, worktreeId],
  );
  const postRef = useRef(post);
  postRef.current = post;

  const flash = useCallback((message: string) => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), 1_800);
  }, []);

  const markWorkspacePaused = useCallback(() => {
    sessionRef.current = null;
    pendingInputRef.current = "";
    setWorkspacePaused(true);
    setError("The terminal disconnected when the workspace stopped.");
    setStatus("ended");
  }, []);

  const reveal = useCallback(() => {
    if (readyRef.current || unmountedRef.current) return;
    readyRef.current = true;
    requestAnimationFrame(() => {
      if (unmountedRef.current) return;
      setReady(true);
      termRef.current?.focus();
    });
  }, []);

  const revealSoon = useCallback(
    (delay: number) => {
      revealTimersRef.current.push(window.setTimeout(reveal, delay));
    },
    [reveal],
  );

  const clearRevealTimers = useCallback(() => {
    for (const timer of revealTimersRef.current) window.clearTimeout(timer);
    revealTimersRef.current = [];
  }, []);

  /** Sends typed or pasted text in order, batching whatever piled up meanwhile. */
  const flushInput = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      while (pendingInputRef.current) {
        const sessionId = sessionRef.current;
        if (!sessionId) {
          pendingInputRef.current = "";
          break;
        }
        const data = takeInputChunk(pendingInputRef.current);
        pendingInputRef.current = pendingInputRef.current.slice(data.length);
        let response: Response | null = null;
        for (let attempt = 0; attempt < 2 && !response; attempt += 1) {
          try {
            response = await postRef.current({
              action: "input",
              sessionId,
              data,
            });
          } catch {
            if (attempt === 0) {
              await new Promise((resolve) => setTimeout(resolve, 400));
            }
          }
        }
        if (!response || PAUSED_STATUSES.includes(response.status)) {
          if (sessionRef.current === sessionId) markWorkspacePaused();
          break;
        }
        lastActivityRef.current = Date.now();
        wakeRef.current?.();
      }
    } finally {
      flushingRef.current = false;
    }
  }, [markWorkspacePaused]);

  const queueInput = useCallback(
    (data: string) => {
      if (!sessionRef.current) return;
      lastActivityRef.current = Date.now();
      const socket = socketRef.current;
      if (
        socket?.readyState === WebSocket.OPEN &&
        !pendingInputRef.current &&
        !flushingRef.current
      ) {
        let rest = data;
        while (rest) {
          const chunk = takeInputChunk(rest);
          rest = rest.slice(chunk.length);
          socket.send(JSON.stringify({ type: "input", data: chunk }));
        }
        return;
      }
      pendingInputRef.current += data;
      lastActivityRef.current = Date.now();
      // Poll for the echo while the keystroke is still on its way.
      wakeRef.current?.();
      void flushInput();
    },
    [flushInput],
  );

  const copySelection = useCallback(async () => {
    const term = termRef.current;
    const text = term?.getSelection() ?? "";
    if (!term || !text) return;
    const copied = await writeClipboard(text);
    flash(copied ? "Copied" : "Couldn't copy");
    term.focus();
  }, [flash]);

  const pasteClipboard = useCallback(async () => {
    const term = termRef.current;
    if (!term || !sessionRef.current) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) term.paste(text);
    } catch {
      flash(isMac() ? "Press ⌘V to paste" : "Press Ctrl+Shift+V to paste");
    }
    term.focus();
  }, [flash]);

  const clearScreen = useCallback(() => {
    termRef.current?.clear();
    termRef.current?.focus();
  }, []);

  const createTerminal = useCallback(
    (modules: XtermModules, host: HTMLDivElement) => {
      const term = new modules.Terminal({
        allowProposedApi: true,
        convertEol: true,
        cursorBlink: false,
        cursorStyle: "block",
        cursorInactiveStyle: "outline",
        fontFamily: FONT_FAMILY,
        fontSize: readFontSize(),
        lineHeight: 1.2,
        scrollback: 10_000,
        smoothScrollDuration: 90,
        macOptionIsMeta: true,
        macOptionClickForcesSelection: true,
        rightClickSelectsWord: true,
        theme: THEME,
      });
      const fit = new modules.FitAddon();
      const search = new modules.SearchAddon();
      term.loadAddon(fit);
      term.loadAddon(search);
      term.loadAddon(new modules.WebLinksAddon());
      term.loadAddon(new modules.Unicode11Addon());
      term.unicode.activeVersion = "11";
      term.open(host);
      // The GPU renderer is what keeps scrolling and fast output smooth. If the
      // context is unavailable or lost, the DOM renderer takes over.
      try {
        const webgl = new modules.WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // No WebGL: keep the DOM renderer.
      }
      search.onDidChangeResults(({ resultIndex, resultCount }) =>
        setFindResults({ index: resultIndex, count: resultCount }),
      );
      term.onData(queueInput);
      term.onSelectionChange(() => setHasSelection(term.hasSelection()));
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown" || event.altKey) return true;
        const mac = isMac();
        const primary = mac ? event.metaKey : event.ctrlKey;
        if (!primary) return true;
        const key = event.key.toLowerCase();
        if (key === "c") {
          if (term.hasSelection()) {
            event.preventDefault();
            void copySelection();
            return false;
          }
          // Ctrl+C with nothing selected is an interrupt, not a copy.
          return !mac && !event.shiftKey;
        }
        // Let the browser's own paste event reach xterm, which brackets it.
        if (key === "v") return false;
        if (key === "f" && (mac ? !event.shiftKey : event.shiftKey)) {
          event.preventDefault();
          openFindRef.current();
          return false;
        }
        if (mac && !event.shiftKey && (key === "=" || key === "+")) {
          event.preventDefault();
          zoomRef.current(1);
          return false;
        }
        if (mac && !event.shiftKey && key === "-") {
          event.preventDefault();
          zoomRef.current(-1);
          return false;
        }
        if (mac && !event.shiftKey && key === "0") {
          event.preventDefault();
          zoomRef.current(0);
          return false;
        }
        if (mac && !event.shiftKey && key === "a") {
          event.preventDefault();
          term.selectAll();
          return false;
        }
        if (mac && !event.shiftKey && key === "k") {
          event.preventDefault();
          term.clear();
          return false;
        }
        return true;
      });
      termRef.current = term;
      fitRef.current = fit;
      searchRef.current = search;
      return term;
    },
    [copySelection, queueInput],
  );

  const fitNow = useCallback(() => {
    const host = hostRef.current;
    if (!host || host.clientWidth === 0 || host.clientHeight === 0) return;
    try {
      fitRef.current?.fit();
    } catch {
      // A pane mid-layout can measure as nothing; the next resize refits.
    }
  }, []);

  /** One write per batch of output: the screen updates in a single paint. */
  const applyOutput = useCallback(
    (data: string) => {
      if (!data) return;
      lastActivityRef.current = Date.now();
      termRef.current?.write(data);
      if (!readyRef.current) revealSoon(REVEAL_SETTLE_MS);
    },
    [revealSoon],
  );

  const applyExit = useCallback(() => {
    sessionRef.current = null;
    pendingInputRef.current = "";
    readyRef.current = true;
    setReady(true);
    setStatus("ended");
    onExitRef.current();
  }, []);

  const start = useCallback(async () => {
    const host = hostRef.current;
    if (!host || startingRef.current || sessionRef.current) return;
    startingRef.current = true;
    clearRevealTimers();
    readyRef.current = false;
    setReady(false);
    setStatus("starting");
    setError("");
    setWorkspacePaused(false);
    setHasSelection(false);
    setUseSocket(typeof WebSocket !== "undefined");

    try {
      const modules = await loadXterm();
      if (unmountedRef.current) return;
      const term = termRef.current ?? createTerminal(modules, host);
      term.reset();
      fitNow();
      dimensionsRef.current = `${term.rows}:${term.cols}`;

      const response = await post({
        action: "start",
        rows: term.rows,
        columns: term.cols,
      });
      if (unmountedRef.current) return;
      const payload = (await response.json().catch(() => ({}))) as {
        sessionId?: string;
        error?: string;
      };
      if (!response.ok || !payload.sessionId) {
        if (PAUSED_STATUSES.includes(response.status)) {
          markWorkspacePaused();
          return;
        }
        setError(payload.error ?? "The terminal could not start.");
        setStatus("idle");
        return;
      }
      sessionRef.current = payload.sessionId;
      afterRef.current = 0;
      pendingInputRef.current = "";
      lastActivityRef.current = Date.now();
      setStatus("live");
      revealSoon(REVEAL_FALLBACK_MS);
    } catch {
      if (unmountedRef.current) return;
      setError("Couldn't reach CoDev. Try again.");
      setStatus("idle");
    } finally {
      startingRef.current = false;
    }
  }, [
    clearRevealTimers,
    createTerminal,
    fitNow,
    markWorkspacePaused,
    post,
    revealSoon,
  ]);

  const closeSession = useCallback(
    (sessionId: string) =>
      fetch(
        `/api/gen2/workspaces/${workspaceId}/terminal?sessionId=${sessionId}&worktreeId=${encodeURIComponent(worktreeId)}`,
        { method: "DELETE", keepalive: true },
      ).catch(() => undefined),
    [workspaceId, worktreeId],
  );

  const restart = useCallback(() => {
    const sessionId = sessionRef.current;
    sessionRef.current = null;
    if (sessionId) void closeSession(sessionId);
    void start();
  }, [closeSession, start]);

  const resumeWorkspace = useCallback(async () => {
    if (!onResumeWorkspace) return;
    const resumed = await onResumeWorkspace().catch(() => false);
    if (resumed && !unmountedRef.current) void start();
  }, [onResumeWorkspace, start]);

  // Warm the terminal bundle so opening the shell never waits on a download.
  useEffect(() => {
    void loadXterm().catch(() => undefined);
  }, []);

  // Open the shell the first time the pane is shown and Codex isn't mid-turn.
  useEffect(() => {
    if (!visible || !canStart || autoStartedRef.current) return;
    if (status !== "idle") return;
    autoStartedRef.current = true;
    void start();
  }, [visible, canStart, status, start]);

  // Long-poll loop, used when no socket is available. Restarted whenever the
  // pane becomes visible again.
  useEffect(() => {
    if (status !== "live" || !visible || useSocket) return;
    let cancelled = false;
    let backoff = 1_000;
    let networkFailures = 0;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const finish = () => {
          window.clearTimeout(timer);
          if (wakeRef.current === finish) wakeRef.current = null;
          resolve();
        };
        const timer = window.setTimeout(finish, ms);
        wakeRef.current = finish;
      });

    async function pump() {
      while (!cancelled) {
        const sessionId = sessionRef.current;
        if (!sessionId) return;
        try {
          const requestedAt = Date.now();
          const response = await postRef.current({
            action: "poll",
            sessionId,
            after: afterRef.current,
          });
          if (cancelled) return;
          if (!response.ok) {
            if (PAUSED_STATUSES.includes(response.status)) {
              markWorkspacePaused();
              return;
            }
            await sleep(backoff);
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
          const data = result.chunks.map((chunk) => chunk.data).join("");
          applyOutput(data);
          afterRef.current = result.nextSequence;
          if (result.exited) {
            applyExit();
            return;
          }
          // The legacy guest endpoint parks this request, while the Superset
          // bridge returns an immediate snapshot. Yield between idle snapshots
          // so an open shell cannot turn into a tight browser request loop;
          // stay quick while the user is typing, and wake on input.
          if (!data && Date.now() - requestedAt < 500) {
            const quiet = Date.now() - lastActivityRef.current;
            await sleep(
              quiet < 400
                ? 25
                : quiet < 3_000
                  ? 60
                  : quiet < 15_000
                    ? 200
                    : 500,
            );
          }
        } catch {
          if (cancelled) return;
          networkFailures += 1;
          if (networkFailures >= 3) {
            markWorkspacePaused();
            return;
          }
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 15_000);
        }
      }
    }

    void pump();
    return () => {
      cancelled = true;
      wakeRef.current?.();
    };
  }, [status, visible, useSocket, markWorkspacePaused, applyOutput, applyExit]);

  // The socket transport: output is pushed the moment the shell prints it and
  // keystrokes skip the per-request HTTP round trip. A dropped socket resumes
  // from the last position seen; one that never opens hands over to polling.
  useEffect(() => {
    if (status !== "live" || !visible || !useSocket) return;
    let cancelled = false;
    let retryTimer = 0;
    let everOpened = false;
    let failures = 0;
    let current: WebSocket | null = null;

    const connect = () => {
      const sessionId = sessionRef.current;
      if (cancelled || !sessionId) return;
      const url = new URL(
        `/api/gen2/workspaces/${workspaceId}/terminal/stream`,
        window.location.href,
      );
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("sessionId", sessionId);
      url.searchParams.set("worktreeId", worktreeId);
      url.searchParams.set("after", String(afterRef.current));

      let opened = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        setUseSocket(false);
        return;
      }
      current = socket;

      socket.onopen = () => {
        opened = true;
        everOpened = true;
        failures = 0;
        socketRef.current = socket;
        // Anything typed while connecting was queued for HTTP; let it drain.
        void flushInput();
        dimensionsRef.current = "";
        syncSizeRef.current();
      };
      socket.onmessage = (event) => {
        let message: {
          type?: string;
          data?: string;
          next?: number;
          message?: string;
        };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.type === "data" && typeof message.data === "string") {
          if (typeof message.next === "number") afterRef.current = message.next;
          applyOutput(message.data);
        } else if (message.type === "exit") {
          if (typeof message.next === "number") afterRef.current = message.next;
          applyExit();
        } else if (message.type === "error") {
          // Let polling find out whether the workspace stopped or the shell
          // hit something transient.
          cancelled = true;
          socket.close();
          setUseSocket(false);
        }
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (cancelled || !sessionRef.current) return;
        if (!opened) {
          failures += 1;
          if (!everOpened || failures >= 3) {
            setUseSocket(false);
            return;
          }
        }
        retryTimer = window.setTimeout(connect, opened ? 0 : 300 * failures);
      };
    };

    connect();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      if (socketRef.current === current) socketRef.current = null;
      current?.close();
    };
  }, [
    status,
    visible,
    useSocket,
    workspaceId,
    worktreeId,
    applyOutput,
    applyExit,
    flushInput,
  ]);

  /** Refit to the pane and tell the PTY when its size actually changed. */
  const syncSize = useCallback(() => {
    const host = hostRef.current;
    const term = termRef.current;
    const sessionId = sessionRef.current;
    if (!host || !term || !sessionId) return;
    // A hidden pane measures zero; fitting against that throws.
    if (host.clientWidth === 0 || host.clientHeight === 0) return;
    fitNow();
    const dimensions = `${term.rows}:${term.cols}`;
    if (dimensions === dimensionsRef.current) return;
    dimensionsRef.current = dimensions;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({ type: "resize", rows: term.rows, columns: term.cols }),
      );
      return;
    }
    void post({
      action: "resize",
      sessionId,
      rows: term.rows,
      columns: term.cols,
    });
  }, [fitNow, post]);
  const syncSizeRef = useRef(syncSize);
  syncSizeRef.current = syncSize;

  // Keep the PTY's idea of the viewport in step with the pane.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || status !== "live") return;
    let timer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(syncSize, 60);
    });
    observer.observe(host);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [status, syncSize]);

  // Command-plus / minus / zero, as in Terminal.app.
  zoomRef.current = (direction) => {
    const term = termRef.current;
    if (!term) return;
    const current = term.options.fontSize ?? FONT_SIZE_DEFAULT;
    const next =
      direction === 0
        ? FONT_SIZE_DEFAULT
        : Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, current + direction));
    if (next === current) return;
    term.options.fontSize = next;
    try {
      window.localStorage.setItem(FONT_SIZE_KEY, String(next));
    } catch {
      // Not persisted; still applied for this session.
    }
    syncSize();
    flash(`${next} pt`);
  };

  const openFind = useCallback(() => {
    setFindOpen(true);
    const selected = termRef.current?.getSelection();
    if (selected && !selected.includes("\n")) setFindQuery(selected);
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, []);
  openFindRef.current = openFind;

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindResults({ index: -1, count: 0 });
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  }, []);

  const runFind = useCallback(
    (query: string, direction: "next" | "previous", incremental = false) => {
      const search = searchRef.current;
      if (!search) return;
      if (!query) {
        search.clearDecorations();
        setFindResults({ index: -1, count: 0 });
        return;
      }
      const options = { incremental, decorations: SEARCH_DECORATIONS };
      if (direction === "next") search.findNext(query, options);
      else search.findPrevious(query, options);
    },
    [],
  );

  // Coming back to the tab: refit (the pane measured zero while hidden) and focus.
  useEffect(() => {
    if (!visible || !ready) return;
    const frame = requestAnimationFrame(() => {
      fitNow();
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, ready, fitNow]);

  // Close the context menu on outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      clearRevealTimers();
      window.clearTimeout(noticeTimerRef.current);
      const sessionId = sessionRef.current;
      sessionRef.current = null;
      if (sessionId) void closeSession(sessionId);
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
  }, [clearRevealTimers, closeSession]);

  const menuAction = (action: () => void) => () => {
    setMenu(null);
    action();
  };

  const isLive = status === "live";
  const isEnded = status === "ended";
  const connecting =
    status === "starting" ||
    (isLive && !ready) ||
    (status === "idle" && !error && canStart);

  let message: TerminalMessageModel | null = null;
  if (workspacePaused) {
    message = {
      tone: "error",
      text: `${error} Resume the workspace to reconnect.`,
      action: onResumeWorkspace
        ? { label: "Resume workspace", run: () => void resumeWorkspace() }
        : undefined,
    };
  } else if (isEnded) {
    message = {
      tone: "info",
      text: "The shell exited.",
      action: canStart
        ? { label: "Start a new terminal", run: restart }
        : undefined,
    };
  } else if (status === "idle" && error) {
    message = {
      tone: "error",
      text: error,
      action: canStart
        ? { label: "Try again", run: () => void start() }
        : undefined,
    };
  } else if (status === "idle" && !canStart) {
    message = {
      tone: "info",
      text: "Codex is working. The terminal opens as soon as its turn ends.",
    };
  }

  const statusLabel = workspacePaused
    ? "Disconnected"
    : isEnded
      ? "Ended"
      : isLive && ready
        ? "Connected"
        : status === "idle" && (error || !canStart)
          ? error
            ? "Offline"
            : "Waiting"
          : "Connecting";
  const sessionActive = isLive && ready;

  return (
    <div className="gen2-term" data-status={statusLabel.toLowerCase()}>
      <div className="gen2-term-bar" role="toolbar" aria-label="Terminal">
        <span
          className="gen2-term-status"
          data-state={statusLabel.toLowerCase()}
        >
          <span className="gen2-term-dot" aria-hidden="true" />
          {statusLabel}
        </span>
        <span className="gen2-term-notice" role="status" aria-live="polite">
          {notice}
        </span>
        <span className="gen2-term-actions">
          <button
            type="button"
            className="gen2-term-action"
            onClick={() => void copySelection()}
            disabled={!hasSelection}
            aria-label="Copy selection"
            title={`Copy selection (${isMac() ? "⌘C" : "Ctrl+Shift+C"})`}
          >
            <Copy size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="gen2-term-action"
            onClick={() => void pasteClipboard()}
            disabled={!sessionActive}
            aria-label="Paste"
            title={`Paste (${isMac() ? "⌘V" : "Ctrl+Shift+V"})`}
          >
            <ClipboardPaste size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="gen2-term-action"
            onClick={openFind}
            disabled={!ready || status === "idle"}
            aria-label="Find in terminal"
            title={`Find (${isMac() ? "⌘F" : "Ctrl+Shift+F"})`}
          >
            <Search size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="gen2-term-action"
            onClick={clearScreen}
            disabled={!ready || status === "idle"}
            aria-label="Clear screen"
            title={isMac() ? "Clear screen (⌘K)" : "Clear screen"}
          >
            <Eraser size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="gen2-term-action"
            onClick={restart}
            disabled={!canStart || status === "starting" || workspacePaused}
            aria-label="Restart terminal"
            title="Restart terminal"
          >
            <RotateCcw size={14} aria-hidden="true" />
          </button>
        </span>
      </div>

      <div
        className="gen2-term-stage"
        ref={stageRef}
        onContextMenu={(event) => {
          if (!ready) return;
          event.preventDefault();
          const rect = stageRef.current?.getBoundingClientRect();
          if (!rect) return;
          setMenu({
            x: Math.min(
              event.clientX - rect.left,
              Math.max(rect.width - 168, 0),
            ),
            y: Math.min(
              event.clientY - rect.top,
              Math.max(rect.height - 170, 0),
            ),
          });
        }}
        onClick={() => termRef.current?.focus()}
      >
        <div className="gen2-term-host" ref={hostRef} data-ready={ready} />

        {!ready ? (
          <div className="gen2-term-overlay">
            {message ? (
              <TerminalMessage message={message} />
            ) : connecting ? (
              <div className="gen2-term-connecting" role="status">
                <span className="gen2-term-skeleton" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>Opening your shell…</span>
              </div>
            ) : null}
          </div>
        ) : message ? (
          <div className="gen2-term-banner">
            <TerminalMessage message={message} compact />
          </div>
        ) : null}

        {findOpen ? (
          <div
            className="gen2-term-find"
            role="search"
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
          >
            <input
              ref={findInputRef}
              value={findQuery}
              placeholder="Find"
              aria-label="Find in terminal"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                setFindQuery(event.target.value);
                runFind(event.target.value, "next", true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeFind();
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  runFind(findQuery, event.shiftKey ? "previous" : "next");
                }
              }}
            />
            <span className="gen2-term-find-count" aria-live="polite">
              {!findQuery
                ? ""
                : findResults.count > 0
                  ? `${findResults.index + 1} of ${findResults.count}`
                  : "No results"}
            </span>
            <button
              type="button"
              aria-label="Previous match"
              title="Previous match (Shift+Enter)"
              onClick={() => runFind(findQuery, "previous")}
            >
              <ChevronUp size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Next match"
              title="Next match (Enter)"
              onClick={() => runFind(findQuery, "next")}
            >
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Close find"
              title="Close (Esc)"
              onClick={closeFind}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {menu ? (
          <div
            className="gen2-term-menu"
            role="menu"
            style={{ left: menu.x, top: menu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              disabled={!hasSelection}
              onClick={menuAction(() => void copySelection())}
            >
              Copy
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!sessionActive}
              onClick={menuAction(() => void pasteClipboard())}
            >
              Paste
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={menuAction(() => termRef.current?.selectAll())}
            >
              Select all
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={menuAction(openFind)}
            >
              Find…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={menuAction(clearScreen)}
            >
              Clear screen
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type TerminalMessageModel = {
  tone: "info" | "error";
  text: string;
  action?: { label: string; run: () => void } | undefined;
};

function TerminalMessage({
  message,
  compact = false,
}: {
  message: TerminalMessageModel;
  compact?: boolean;
}) {
  return (
    <div
      className="gen2-term-message"
      data-tone={message.tone}
      data-compact={compact}
      role={message.tone === "error" ? "alert" : "status"}
    >
      <p>{message.text}</p>
      {message.action ? (
        <button
          type="button"
          className="gen2-term-message-action"
          onClick={message.action.run}
        >
          {message.action.label}
        </button>
      ) : null}
    </div>
  );
}

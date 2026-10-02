"use client";

type Post = (body: Record<string, unknown>) => Promise<Response>;

type Attachment = {
  workspaceId: string;
  worktreeId: string;
  sessionId: string;
  post: Post;
  onChunk: (data: string) => void;
  onCursor: (after: number) => void;
  onExit: () => void;
  onPaused: () => void;
};

type Session = Attachment & {
  stopped: boolean;
  after: number;
  pending: string;
  resize: { rows: number; columns: number } | null;
  socket: WebSocket | null;
  usingHttp: boolean;
  everOpened: boolean;
  httpWake: (() => void) | null;
};

export type TerminalTransport = {
  sendInput: (data: string) => void;
  sendResize: (rows: number, columns: number) => void;
  stop: () => void;
};

const PAUSED = new Set([404, 502, 503]);

/**
 * Attaches the current shell to Marwan's terminal stream (320c5f27).
 * The browser talks to this app; the app holds one upstream poll and pushes
 * output. Polling remains the fallback when that socket never opens.
 * Keys are not echoed locally.
 */
export function attachTerminalTransport(
  options: Attachment & { after: number },
): TerminalTransport {
  const session: Session = {
    ...options,
    stopped: false,
    pending: "",
    resize: null,
    socket: null,
    usingHttp: false,
    everOpened: false,
    httpWake: null,
  };
  void connect(session, 0).catch(() => {
    if (!session.stopped) startHttp(session);
  });
  return {
    sendInput(data) {
      session.pending += data;
      flush(session);
    },
    sendResize(rows, columns) {
      session.resize = { rows, columns };
      flush(session);
    },
    stop() {
      session.stopped = true;
      session.socket?.close();
      session.httpWake?.();
    },
  };
}

function flush(session: Session) {
  if (session.usingHttp) {
    session.httpWake?.();
    return;
  }
  const socket = session.socket;
  if (socket?.readyState !== WebSocket.OPEN) return;
  while (session.pending) {
    const data = takePending(session);
    socket.send(JSON.stringify({ type: "input", data }));
  }
  if (session.resize) {
    socket.send(JSON.stringify({ type: "resize", ...session.resize }));
    session.resize = null;
  }
}

function takePending(session: Session) {
  let end = Math.min(session.pending.length, 8_192);
  const cut = session.pending[end - 1] ?? "";
  if (end < session.pending.length && /[\uD800-\uDBFF]/.test(cut)) end--;
  const data = session.pending.slice(0, end);
  session.pending = session.pending.slice(end);
  return data;
}

function startHttp(session: Session) {
  if (session.usingHttp || session.stopped) return;
  session.usingHttp = true;
  session.socket?.close();
  session.socket = null;
  void pumpHttp(session);
}

async function pumpHttp(session: Session) {
  let backoff = 1_000;
  let failures = 0;
  while (!session.stopped) {
    if (session.pending) {
      const response = await session.post({
        action: "input",
        sessionId: session.sessionId,
        data: takePending(session),
      });
      if (PAUSED.has(response.status)) return session.onPaused();
    }
    const size = session.resize;
    if (size) {
      session.resize = null;
      void session.post({
        action: "resize",
        sessionId: session.sessionId,
        ...size,
      });
    }
    const step = await pollHttp(session);
    if (step === "stop") return;
    if (step === "pause") return session.onPaused();
    if (step === "retry") {
      failures += 1;
      if (failures >= 3) return session.onPaused();
      await wait(backoff, session);
      backoff = Math.min(backoff * 2, 15_000);
      continue;
    }
    failures = 0;
    backoff = 1_000;
    if (step === "idle") await wait(150, session);
  }
}

async function pollHttp(
  session: Session,
): Promise<"ok" | "idle" | "retry" | "pause" | "stop"> {
  try {
    const response = await session.post({
      action: "poll",
      sessionId: session.sessionId,
      after: session.after,
    });
    if (session.stopped) return "stop";
    if (!response.ok) return PAUSED.has(response.status) ? "pause" : "retry";
    const result = (await response.json()) as {
      chunks: { data: string }[];
      nextSequence: number;
      exited: boolean;
    };
    for (const chunk of result.chunks) session.onChunk(chunk.data);
    session.after = result.nextSequence;
    session.onCursor(session.after);
    if (result.exited) {
      session.onExit();
      return "stop";
    }
    return result.chunks.length === 0 && !session.pending ? "idle" : "ok";
  } catch {
    return session.stopped ? "stop" : "retry";
  }
}

function connect(session: Session, failures: number) {
  if (session.stopped || session.usingHttp) return;
  const url = new URL(
    `/api/gen2/workspaces/${session.workspaceId}/terminal/stream`,
    window.location.href,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("sessionId", session.sessionId);
  url.searchParams.set("worktreeId", session.worktreeId);
  url.searchParams.set("after", String(session.after));
  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch {
    startHttp(session);
    return;
  }
  session.socket = socket;
  let opened = false;
  let ended = false;
  socket.onopen = () => {
    opened = true;
    session.everOpened = true;
    flush(session);
  };
  socket.onmessage = (event) => {
    const action = applySocketMessage(session, event.data);
    if (action === "exit") {
      ended = true;
      socket.close();
    } else if (action === "fallback") {
      ended = true;
      socket.close();
      startHttp(session);
    }
  };
  socket.onclose = () => {
    if (session.socket === socket) session.socket = null;
    if (session.stopped || ended || session.usingHttp) return;
    if (!opened) {
      const next = failures + 1;
      if (!session.everOpened || next >= 3) {
        startHttp(session);
        return;
      }
      window.setTimeout(() => connect(session, next), 300 * next);
      return;
    }
    window.setTimeout(() => connect(session, 0), 0);
  };
}

function applySocketMessage(session: Session, data: unknown) {
  try {
    const message = JSON.parse(String(data)) as {
      type?: string;
      data?: string;
      next?: number;
    };
    if (message.type === "data" && typeof message.data === "string") {
      if (typeof message.next === "number") {
        session.after = message.next;
        session.onCursor(message.next);
      }
      session.onChunk(message.data);
      return "data";
    }
    if (message.type === "exit") {
      if (typeof message.next === "number") {
        session.after = message.next;
        session.onCursor(message.next);
      }
      session.onExit();
      return "exit";
    }
    if (message.type === "error") return "fallback";
    return "ignore";
  } catch {
    return "ignore";
  }
}

function wait(milliseconds: number, session: Session) {
  return new Promise<void>((resolve) => {
    let timer = 0;
    const finish = () => {
      window.clearTimeout(timer);
      resolve();
    };
    session.httpWake = finish;
    timer = window.setTimeout(finish, milliseconds);
  });
}

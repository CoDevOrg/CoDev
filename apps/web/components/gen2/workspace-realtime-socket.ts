import {
  collaborationServerMessageSchema,
  type CollaborationClientMessage,
  type CollaborationServerMessage,
} from "@codev/contracts";

export type RealtimeStatus = "connecting" | "open" | "reconnecting";

type Welcome = Extract<CollaborationServerMessage, { type: "welcome" }>;

export function encodeBase64(bytes: Uint8Array) {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    value += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(value);
}

export function decodeBase64(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function socketUrl(workspaceId: string) {
  const url = new URL(
    `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/collaboration`,
    window.location.href,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function parse(data: unknown) {
  if (typeof data !== "string") return null;
  try {
    const parsed = collaborationServerMessageSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The one collaboration socket a workspace tab keeps open. It reconnects with
 * jittered backoff and reports each welcome, so the owner can replay its
 * worktree, focus and document subscriptions. Sends before a welcome are
 * dropped: that state is replayed, and edits resync from state vectors.
 */
export function connectWorkspaceRealtime(input: {
  workspaceId: string;
  worktreeId: () => string;
  onWelcome: (welcome: Welcome, reconnected: boolean) => void;
  onMessage: (message: CollaborationServerMessage) => void;
  onStatus: (status: RealtimeStatus) => void;
}) {
  let socket: WebSocket | null = null;
  let open = false;
  let disposed = false;
  let retries = 0;
  let welcomed = 0;
  let heartbeat: number | null = null;
  let reconnect: number | null = null;

  const send = (message: CollaborationClientMessage) => {
    if (open && socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message));
  };
  const stopHeartbeat = () => {
    if (heartbeat !== null) window.clearInterval(heartbeat);
    heartbeat = null;
  };
  const welcome = (message: Welcome) => {
    open = true;
    retries = 0;
    stopHeartbeat();
    heartbeat = window.setInterval(
      () => send({ type: "heartbeat" }),
      Math.max(1_000, Math.floor(message.heartbeatIntervalMs / 2)),
    );
    input.onStatus("open");
    input.onWelcome(message, (welcomed += 1) > 1);
  };
  const connect = () => {
    if (disposed) return;
    input.onStatus(welcomed ? "reconnecting" : "connecting");
    const next = new WebSocket(socketUrl(input.workspaceId));
    socket = next;
    next.onopen = () =>
      next.send(
        JSON.stringify({ type: "join", worktreeId: input.worktreeId() }),
      );
    next.onmessage = (event) => {
      const message = parse(event.data);
      if (!message) return;
      if (message.type === "welcome") welcome(message);
      else input.onMessage(message);
    };
    next.onclose = () => {
      if (socket !== next) return;
      open = false;
      socket = null;
      stopHeartbeat();
      if (disposed) return;
      input.onStatus(welcomed ? "reconnecting" : "connecting");
      const base = Math.min(1_000 * 2 ** Math.min(retries, 4), 15_000);
      retries += 1;
      reconnect = window.setTimeout(
        connect,
        base / 2 + (Math.random() * base) / 2,
      );
    };
  };
  connect();

  return {
    send,
    close() {
      disposed = true;
      if (reconnect !== null) window.clearTimeout(reconnect);
      stopHeartbeat();
      socket?.close();
      socket = null;
    },
  };
}

export type WorkspaceRealtimeConnection = ReturnType<
  typeof connectWorkspaceRealtime
>;

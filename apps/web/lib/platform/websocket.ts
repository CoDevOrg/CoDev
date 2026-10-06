import type { WebSocket as VercelWebSocket } from "ws";

export type WebSocketMessage = {
  data: string | null;
  isBinary: boolean;
};

export interface ServerWebSocket {
  readonly readyState: number;
  readonly openState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  onMessage(listener: (message: WebSocketMessage) => void): void;
  onceClose(listener: () => void): void;
  onceError(listener: () => void): void;
}

export const cloudflareWebSocketUpgradeIdHeader = "x-codev-websocket-id";

const cloudflareClientSockets = new Map<
  string,
  { socket: WebSocket; initialized: Promise<void> }
>();

export function takeCloudflareWebSocket(id: string) {
  const socket = cloudflareClientSockets.get(id);
  cloudflareClientSockets.delete(id);
  return socket;
}

function payloadSize(data: unknown): number {
  if (typeof data === "string")
    return new TextEncoder().encode(data).byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (Array.isArray(data)) {
    return data.reduce((total, part) => total + payloadSize(part), 0);
  }
  return Number.POSITIVE_INFINITY;
}

function decodeText(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }
  if (Array.isArray(data) && data.every(ArrayBuffer.isView)) {
    const size = payloadSize(data);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of data) {
      const chunk = new Uint8Array(
        part.buffer,
        part.byteOffset,
        part.byteLength,
      );
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }
  return null;
}

function fromVercel(socket: VercelWebSocket): ServerWebSocket {
  return {
    get readyState() {
      return socket.readyState;
    },
    openState: 1,
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    terminate: () => socket.terminate(),
    onMessage(listener) {
      socket.on("message", (data, isBinary) => {
        listener({
          data: isBinary ? null : decodeText(data),
          isBinary,
        });
      });
    },
    onceClose(listener) {
      socket.once("close", listener);
    },
    onceError(listener) {
      socket.once("error", listener);
    },
  };
}

function fromCloudflare(
  socket: WebSocket,
  maxPayload: number,
): ServerWebSocket {
  return {
    get readyState() {
      return socket.readyState;
    },
    openState: 1,
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    terminate: () => socket.close(1011, "WebSocket heartbeat timed out."),
    onMessage(listener) {
      socket.addEventListener("message", (event) => {
        const isBinary = typeof event.data !== "string";
        if (payloadSize(event.data) > maxPayload) {
          socket.close(1009, "WebSocket message is too large.");
          return;
        }
        listener({
          data: isBinary ? null : decodeText(event.data),
          isBinary,
        });
      });
    },
    onceClose(listener) {
      socket.addEventListener("close", listener, { once: true });
    },
    onceError(listener) {
      socket.addEventListener("error", listener, { once: true });
    },
  };
}

export async function upgradeWebSocket(
  request: Request,
  onConnect: (socket: ServerWebSocket) => void | Promise<void>,
  options: { maxPayload: number },
) {
  if (typeof WebSocketPair === "function") {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const initialized = Promise.resolve(
      onConnect(fromCloudflare(server, options.maxPayload)),
    )
      .then(() => undefined)
      .catch((error: unknown) => {
        console.error(
          "WebSocket initialization failed",
          error instanceof Error ? error.message : "unknown",
        );
        server.close(1011, "WebSocket handler failed.");
      });
    const upgradeId = request.headers.get(cloudflareWebSocketUpgradeIdHeader);
    if (upgradeId) {
      cloudflareClientSockets.set(upgradeId, { socket: client, initialized });
      return new Response(null, {
        status: 204,
        headers: { "cache-control": "no-store" },
      });
    }
    return new Response(null, {
      status: 101,
      headers: { "cache-control": "no-store" },
      webSocket: client,
    });
  }

  const { experimental_upgradeWebSocket } = await import("@vercel/functions");
  return experimental_upgradeWebSocket((socket) => {
    const adapted = fromVercel(socket as VercelWebSocket);
    void Promise.resolve(onConnect(adapted)).catch(() => adapted.terminate());
  }, options);
}

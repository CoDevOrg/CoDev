import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

const upgradeHeader = "x-codev-node-websocket-id";
const pending = (globalThis.__codevNodeWebSocketUpgrades ??= new Map());

function adapt(socket) {
  return {
    get readyState() {
      return socket.readyState;
    },
    openState: 1,
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    terminate: () => socket.terminate(),
    onMessage: (listener) =>
      socket.on("message", (data, isBinary) =>
        listener({ data: isBinary ? null : data.toString(), isBinary }),
      ),
    onceClose: (listener) => socket.once("close", listener),
    onceError: (listener) => socket.once("error", listener),
  };
}

/** Run the existing authenticated Next route before accepting a native socket. */
export async function handleNodeUpgrade(request, socket, head, port) {
  const id = randomUUID();
  let accepted;
  pending.set(id, (connect, options) => {
    const server = new WebSocketServer({ noServer: true, ...options });
    server.handleUpgrade(request, socket, head, (client) => {
      accepted = client;
      client.on("error", () => client.terminate());
      Promise.resolve()
        .then(() => connect(adapt(client)))
        .catch(() => client.close(1011));
    });
  });
  socket.once("close", () => pending.delete(id));
  try {
    const headers = { ...request.headers, [upgradeHeader]: id };
    delete headers.upgrade;
    delete headers.connection;
    const response = await fetch(`http://127.0.0.1:${port}${request.url}`, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    if (!accepted) {
      const status = response.status === 204 ? 503 : response.status;
      socket.end(
        `HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    }
  } catch {
    accepted?.close(1011, "WebSocket initialization failed.");
    if (!accepted) socket.destroy();
  } finally {
    pending.delete(id);
  }
}

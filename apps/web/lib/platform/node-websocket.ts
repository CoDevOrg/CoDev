import type { ServerWebSocket } from "./websocket";

export const nodeWebSocketUpgradeHeader = "x-codev-node-websocket-id";
type Upgrade = (
  connect: (socket: ServerWebSocket) => void | Promise<void>,
  options: { maxPayload: number },
) => void;

/** The Node server registers a one-use capability only for a pending socket. */
export function upgradeNodeWebSocket(
  request: Request,
  connect: (socket: ServerWebSocket) => void | Promise<void>,
  options: { maxPayload: number },
) {
  const state = globalThis as typeof globalThis & {
    __codevNodeWebSocketUpgrades?: Map<string, Upgrade>;
  };
  const id = request.headers.get(nodeWebSocketUpgradeHeader);
  const upgrade = id && state.__codevNodeWebSocketUpgrades?.get(id);
  if (!upgrade) return undefined;
  state.__codevNodeWebSocketUpgrades?.delete(id);
  upgrade(connect, options);
  return new Response(null, { status: 204 });
}

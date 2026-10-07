import "server-only";

import type { ServerWebSocket, WebSocketMessage } from "../platform/websocket";
import type { AppUser } from "./identity";
import { readSessionRevision } from "./read-session-revision";

const RECHECK_MS = 15_000;

function bufferedMessages(socket: ServerWebSocket) {
  let listener: ((message: WebSocketMessage) => void) | undefined;
  let pending: WebSocketMessage[] = [];
  socket.onMessage((message) => {
    if (listener) return listener(message);
    if (pending.length >= 16) {
      socket.close(1009, "Session validation is still pending.");
      return;
    }
    pending.push(message);
  });
  return (next: (message: WebSocketMessage) => void) => {
    listener = next;
    pending.forEach(next);
    pending = [];
  };
}

function sessionCheck(socket: ServerWebSocket, user: AppUser) {
  let checkedAt = Number.NEGATIVE_INFINITY;
  let pending: Promise<boolean> | undefined;
  let revoked = false;
  return async (force = false): Promise<boolean> => {
    if (revoked) return false;
    if (!force && Date.now() - checkedAt < RECHECK_MS) return true;
    pending ??= (async () => {
      try {
        const revision = await readSessionRevision(user.id);
        if (revision && user.credentialRevision === revision) {
          checkedAt = Date.now();
          return true;
        }
      } catch {
        // Losing storage must not leave a revoked session connected.
      }
      revoked = true;
      if (socket.readyState === socket.openState)
        socket.close(1008, "Sign in again to reconnect.");
      return false;
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
}

/** Revalidate long-lived browser sockets after credential changes or deletion. */
export async function guardSessionSocket(
  socket: ServerWebSocket,
  user: AppUser,
) {
  // The browser may send its join message immediately after the upgrade.
  const subscribe = bufferedMessages(socket);
  const check = sessionCheck(socket, user);
  if (!(await check()) || socket.readyState !== socket.openState) return null;
  const timer = setInterval(() => {
    void check(true);
  }, RECHECK_MS);
  socket.onceClose(() => clearInterval(timer));
  socket.onceError(() => clearInterval(timer));
  return {
    get readyState() {
      return socket.readyState;
    },
    openState: socket.openState,
    send: socket.send.bind(socket),
    close: socket.close.bind(socket),
    terminate: socket.terminate.bind(socket),
    onMessage(listener) {
      subscribe((message) => {
        void check().then((allowed) => {
          if (allowed) listener(message);
        });
      });
    },
    onceClose: socket.onceClose.bind(socket),
    onceError: socket.onceError.bind(socket),
  } satisfies ServerWebSocket;
}

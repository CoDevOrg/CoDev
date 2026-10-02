import "server-only";

import {
  collaborationServerMessageSchema,
  type CollaborationServerMessage,
  type CollaborationUser,
} from "@codev/contracts";
import type { WebSocket } from "ws";

/** One open collaboration socket and everything scoped to it. */
export interface Connection {
  id: string;
  socket: WebSocket;
  user: CollaborationUser;
  joined: boolean;
  worktreeId: string | null;
  subscriptions: Set<string>;
  activePath: string | null;
  cursor: { anchor: number; head: number } | null;
  resumeFrom: string | null;
  replayedPaths: Set<string>;
  alive: boolean;
  canEdit: boolean;
}

export function send(
  connection: Connection,
  message: CollaborationServerMessage,
) {
  if (connection.socket.readyState !== connection.socket.OPEN) return;
  const payload = collaborationServerMessageSchema.parse(message);
  connection.socket.send(JSON.stringify(payload));
}

export function sendError(
  connection: Connection,
  code: Extract<CollaborationServerMessage, { type: "error" }>["code"],
  message: string,
  retryable: boolean,
  path?: string,
) {
  send(connection, { type: "error", code, message, retryable, path });
}

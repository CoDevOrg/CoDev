import "server-only";

import {
  collaborationServerMessageSchema,
  type CollaborationServerMessage,
  type CollaborationUser,
  type Gen2WorkspaceView,
} from "@codev/contracts";
import type { ServerWebSocket } from "../platform/websocket";

/** One open collaboration socket and everything scoped to it. */
export interface Connection {
  id: string;
  socket: ServerWebSocket;
  user: CollaborationUser;
  joined: boolean;
  worktreeId: string | null;
  subscriptions: Set<string>;
  activePath: string | null;
  cursor: { anchor: number; head: number } | null;
  view: Gen2WorkspaceView | null;
  chatId: string | null;
  away: boolean;
  lastTypingAt: number;
  resumeFrom: string | null;
  replayedPaths: Set<string>;
  lastSeenAt: number;
  canEdit: boolean;
  /** Edits not yet persisted, per `${worktreeId}\0${path}`, in arrival order. */
  pendingUpdates: Map<string, string[]>;
  /** Files written to the workspace shortly after their last edit. */
  autosaves: Map<
    string,
    {
      timer: ReturnType<typeof setTimeout>;
      firstAt: number;
      run: () => Promise<void>;
    }
  >;
}

export function send(
  connection: Connection,
  message: CollaborationServerMessage,
) {
  const payload = collaborationServerMessageSchema.parse(message);
  sendSerialized(connection, JSON.stringify(payload));
}

/** Sends an already validated message, so a broadcast serializes it once. */
export function sendSerialized(connection: Connection, payload: string) {
  if (connection.socket.readyState !== connection.socket.openState) return;
  connection.socket.send(payload);
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

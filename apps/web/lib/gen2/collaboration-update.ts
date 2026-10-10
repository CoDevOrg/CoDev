import "server-only";

import * as Y from "yjs";

import {
  decodeBase64,
  docFromUpdate,
  encodedDocument,
} from "../collaboration/yjs-document";
import { withDatabaseOperation } from "../platform/database-operation";
import { logEvent } from "../platform/observability";
import { sendError, type Connection } from "./collaboration-connection";
import { withDocumentLock } from "./collaboration-redis";
import { publishStamped } from "./collaboration-rooms";
import { loadGen2Document, saveGen2Document } from "./collaboration-documents";
import { gen2CollaborationRoom } from "./collaboration-events";
import { scheduleAutosave } from "./collaboration-autosave";

/** Long enough to outlast another member's write; edits never fail on contention. */
const LOCK_WAIT_MS = 10_000;

/** Folds a batch of edits into the stored document under its lock. */
async function persist(
  workspaceId: string,
  worktreeId: string,
  path: string,
  updates: string[],
) {
  await withDocumentLock(
    gen2CollaborationRoom(workspaceId),
    worktreeId,
    path,
    async () => {
      const snapshot = await loadGen2Document(workspaceId, worktreeId, path);
      if (!snapshot)
        throw new Error("The collaborative document was not found.");
      const doc = docFromUpdate(snapshot.update);
      for (const update of updates)
        Y.applyUpdate(doc, decodeBase64(update), "client");
      await saveGen2Document(
        { ...snapshot, ...encodedDocument(doc) },
        snapshot.hasConflict ? snapshot.conflictFilesystemRevision : null,
      );
    },
    { waitMs: LOCK_WAIT_MS },
  );
}

/**
 * Persists this socket's queued edits for one file, one batch at a time, in
 * arrival order. Only the first caller drains; later edits join its queue.
 */
async function drain(
  workspaceId: string,
  connection: Connection,
  worktreeId: string,
  path: string,
) {
  const key = `${worktreeId}\0${path}`;
  const queue = connection.pendingUpdates.get(key);
  if (!queue || queue.length !== 1) return;
  try {
    while (queue.length) {
      const batch = queue.slice();
      await withDatabaseOperation(() =>
        persist(workspaceId, worktreeId, path, batch),
      );
      queue.splice(0, batch.length);
      scheduleAutosave(connection, { workspaceId, worktreeId, path });
    }
  } catch (error) {
    queue.length = 0;
    logEvent("error", "gen2.collaboration.persist_failed", {
      workspaceId,
      detail: error instanceof Error ? error.message : "unknown",
    });
    // The member's next sync resends what the server is missing.
    sendError(
      connection,
      "internal_error",
      "Some edits were not saved yet. Reconnecting will resend them.",
      true,
      path,
    );
  } finally {
    if (!queue.length) connection.pendingUpdates.delete(key);
  }
}

/**
 * Sends an edit to everyone at once, then persists it. Fan-out never waits
 * on the database or the workspace, so typing stays live under contention.
 */
export async function applyUpdate(
  workspaceId: string,
  connection: Connection,
  path: string,
  update: string,
) {
  const worktreeId = connection.worktreeId;
  if (!worktreeId) {
    sendError(connection, "not_joined", "Join a worktree first.", false, path);
    return;
  }
  await publishStamped(
    gen2CollaborationRoom(workspaceId),
    (streamId) => ({
      type: "update",
      worktreeId,
      path,
      update,
      revision: "live",
      actorId: connection.user.id,
      streamId,
    }),
    connection,
  );
  const key = `${worktreeId}\0${path}`;
  const queue = connection.pendingUpdates.get(key) ?? [];
  queue.push(update);
  connection.pendingUpdates.set(key, queue);
  await drain(workspaceId, connection, worktreeId, path);
}

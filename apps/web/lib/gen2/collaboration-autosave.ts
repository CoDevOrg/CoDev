import "server-only";

import { docFromUpdate } from "../collaboration/yjs-document";
import { withDatabaseOperation } from "../platform/database-operation";
import { logEvent } from "../platform/observability";
import type { Connection } from "./collaboration-connection";
import { withDocumentLock } from "./collaboration-redis";
import { publish } from "./collaboration-rooms";
import { loadGen2Document, saveGen2Document } from "./collaboration-documents";
import { gen2CollaborationRoom } from "./collaboration-events";
import { Gen2FileConflictError } from "./errors";
import { saveGen2SupersetFile } from "./superset";

/** Write a moment after typing pauses, and at least this often while it doesn't. */
const QUIET_MS = 1_000;
const MAX_WAIT_MS = 5_000;
const LOCK_WAIT_MS = 10_000;

type Target = { workspaceId: string; worktreeId: string; path: string };

/**
 * Writes the shared text to the workspace file when it differs from disk.
 * The caller holds the document lock; `announceWrite` tells editors after.
 */
export async function writeSharedFile(target: Target, userId: string) {
  const snapshot = await loadGen2Document(
    target.workspaceId,
    target.worktreeId,
    target.path,
  );
  if (!snapshot || snapshot.hasConflict) return null;
  const contents = docFromUpdate(snapshot.update).getText("content").toString();
  if (contents === snapshot.filesystemContents) return null;
  try {
    const file = await saveGen2SupersetFile(target.workspaceId, userId, {
      worktreeId: target.worktreeId,
      path: target.path,
      contents,
      expectedRevision: snapshot.filesystemRevision ?? snapshot.revision,
    });
    return { saved: file.revision } as const;
  } catch (error) {
    if (!(error instanceof Gen2FileConflictError)) throw error;
    // Someone changed the file outside the editor: keep both, show it.
    await saveGen2Document(snapshot, error.currentRevision);
    return {
      conflict: error.currentRevision,
      snapshotRevision: snapshot.revision,
    } as const;
  }
}

export async function announceWrite(
  target: Target,
  result: Awaited<ReturnType<typeof writeSharedFile>>,
) {
  if (!result) return;
  const room = gen2CollaborationRoom(target.workspaceId);
  if ("saved" in result)
    await publish(room, {
      type: "reconciled",
      worktreeId: target.worktreeId,
      path: target.path,
      revision: result.saved,
      source: "collaboration",
    });
  else
    await publish(room, {
      type: "conflict",
      worktreeId: target.worktreeId,
      path: target.path,
      snapshotRevision: result.snapshotRevision,
      filesystemRevision: result.conflict,
      message:
        "This file changed in the workspace while it was being edited. Neither version was overwritten.",
    });
}

async function autosave(target: Target, userId: string) {
  const result = await withDocumentLock(
    gen2CollaborationRoom(target.workspaceId),
    target.worktreeId,
    target.path,
    () => writeSharedFile(target, userId),
    { waitMs: LOCK_WAIT_MS },
  );
  await announceWrite(target, result);
}

/**
 * Saves a shared file to the workspace shortly after its last edit, like
 * other collaborative editors: members never press Save or discard. One
 * pending write per file per socket; a closing socket writes at once.
 */
export function scheduleAutosave(
  connection: Connection,
  target: Target,
  now = Date.now(),
) {
  const key = `${target.worktreeId}\0${target.path}`;
  const existing = connection.autosaves.get(key);
  if (existing) clearTimeout(existing.timer);
  const firstAt = existing?.firstAt ?? now;
  const run = async () => {
    connection.autosaves.delete(key);
    await withDatabaseOperation(() =>
      autosave(target, connection.user.id),
    ).catch((error) =>
      logEvent("warn", "gen2.collaboration.autosave_failed", {
        workspaceId: target.workspaceId,
        detail: error instanceof Error ? error.message : "unknown",
      }),
    );
  };
  const delay = Math.min(QUIET_MS, Math.max(0, firstAt + MAX_WAIT_MS - now));
  connection.autosaves.set(key, {
    firstAt,
    run,
    timer: setTimeout(() => void run(), delay),
  });
}

/** Writes every pending file now; called before a socket's resources close. */
export async function flushAutosaves(connection: Connection) {
  const pending = [...connection.autosaves.values()];
  pending.forEach((entry) => clearTimeout(entry.timer));
  await Promise.all(pending.map((entry) => entry.run()));
}

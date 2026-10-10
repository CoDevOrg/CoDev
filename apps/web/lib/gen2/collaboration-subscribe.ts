import "server-only";

import * as Y from "yjs";

import {
  decodeBase64,
  docFromUpdate,
  encodeBase64,
} from "../collaboration/yjs-document";
import { send, sendError, type Connection } from "./collaboration-connection";
import { withDocumentLock } from "./collaboration-redis";
import { publish, replay } from "./collaboration-rooms";
import { refreshPresence } from "./collaboration-presence";
import {
  initializeGen2Document,
  loadGen2Document,
  reconcileGen2Document,
} from "./collaboration-documents";
import { gen2CollaborationRoom } from "./collaboration-events";
import { announceWrite, writeSharedFile } from "./collaboration-autosave";

const LOCK_WAIT_MS = 10_000;

export async function subscribe(
  workspaceId: string,
  connection: Connection,
  path: string,
  stateVector?: string,
) {
  // Messages are not serialized; a focus change must not redirect this one.
  const worktreeId = connection.worktreeId;
  if (!worktreeId) {
    sendError(connection, "not_joined", "Join a worktree first.", false, path);
    return;
  }
  const roomKey = gen2CollaborationRoom(workspaceId);
  const result = await withDocumentLock(
    roomKey,
    worktreeId,
    path,
    async () => {
      const snapshot =
        (await loadGen2Document(workspaceId, worktreeId, path)) ??
        (await initializeGen2Document(
          workspaceId,
          connection.user.id,
          worktreeId,
          path,
        ));
      const reconciled = await reconcileGen2Document(
        workspaceId,
        connection.user.id,
        snapshot,
      );
      const written =
        reconciled.event?.type === "reconciled" && reconciled.event.needsWrite
          ? await writeSharedFile(
              { workspaceId, worktreeId, path },
              connection.user.id,
            )
          : null;
      return { ...reconciled, written };
    },
    { waitMs: LOCK_WAIT_MS },
  );
  if (connection.worktreeId !== worktreeId) return;
  connection.subscriptions.add(path);
  connection.activePath = path;
  if (result.event?.type === "reconciled") {
    await publish(roomKey, {
      type: "reconciled",
      worktreeId,
      path,
      revision: result.event.revision,
      source: "filesystem",
      update: result.event.update,
      range: result.event.range,
    });
    await announceWrite({ workspaceId, worktreeId, path }, result.written);
  } else if (result.event?.type === "conflict") {
    await publish(roomKey, {
      type: "conflict",
      worktreeId,
      path,
      snapshotRevision: result.event.snapshotRevision,
      filesystemRevision: result.event.filesystemRevision,
      message:
        "The shared document and workspace file both changed. Neither version was overwritten.",
    });
  }
  if (connection.resumeFrom && !connection.replayedPaths.has(path)) {
    connection.replayedPaths.add(path);
    await replay(roomKey, connection, connection.resumeFrom, path);
  }
  const doc = docFromUpdate(result.snapshot.update);
  const update = stateVector
    ? Y.encodeStateAsUpdate(doc, decodeBase64(stateVector))
    : Y.encodeStateAsUpdate(doc);
  send(connection, {
    type: "sync",
    path,
    update: encodeBase64(update),
    stateVector: encodeBase64(Y.encodeStateVector(doc)),
    revision: result.snapshot.revision,
  });
  await refreshPresence(roomKey, connection, { changed: true });
}

/** Stops document fan-out for a file this tab closed. */
export async function unsubscribe(
  workspaceId: string,
  connection: Connection,
  path: string,
) {
  connection.subscriptions.delete(path);
  if (connection.activePath !== path) return;
  connection.activePath = null;
  connection.cursor = null;
  await refreshPresence(gen2CollaborationRoom(workspaceId), connection, {
    changed: true,
  });
}

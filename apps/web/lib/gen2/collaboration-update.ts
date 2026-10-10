import "server-only";

import * as Y from "yjs";

import {
  decodeBase64,
  docFromUpdate,
  encodedDocument,
} from "../collaboration/yjs-document";
import { sendError, type Connection } from "./collaboration-connection";
import { withDocumentLock } from "./collaboration-redis";
import { publish, publishStamped } from "./collaboration-rooms";
import {
  loadGen2Document,
  reconcileGen2Document,
  saveGen2Document,
} from "./collaboration-documents";
import { gen2CollaborationRoom } from "./collaboration-events";

async function mergeUpdate(
  workspaceId: string,
  connection: Connection,
  worktreeId: string,
  path: string,
  update: string,
) {
  const loaded = await loadGen2Document(workspaceId, worktreeId, path);
  if (!loaded) throw new Error("The collaborative document was not found.");
  const reconciled = await reconcileGen2Document(
    workspaceId,
    connection.user.id,
    loaded,
  );
  if (reconciled.event?.type === "conflict") {
    return { conflict: reconciled.event, reconciled: null, revision: null };
  }
  const doc = docFromUpdate(reconciled.snapshot.update);
  Y.applyUpdate(doc, decodeBase64(update), "client");
  await saveGen2Document({ ...reconciled.snapshot, ...encodedDocument(doc) });
  return {
    conflict: null,
    reconciled:
      reconciled.event?.type === "reconciled" ? reconciled.event : null,
    revision: reconciled.snapshot.revision,
  };
}

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
  const roomKey = gen2CollaborationRoom(workspaceId);
  const outcome = await withDocumentLock(roomKey, worktreeId, path, () =>
    mergeUpdate(workspaceId, connection, worktreeId, path, update),
  );
  if (outcome.conflict) {
    await publish(roomKey, {
      type: "conflict",
      worktreeId,
      path,
      snapshotRevision: outcome.conflict.snapshotRevision,
      filesystemRevision: outcome.conflict.filesystemRevision,
      message:
        "A collaborative edit arrived after the file changed on the workspace. Neither version was overwritten.",
    });
    return;
  }
  if (outcome.reconciled) {
    await publish(roomKey, {
      type: "reconciled",
      worktreeId,
      path,
      revision: outcome.reconciled.revision,
      source: "filesystem",
      update: outcome.reconciled.update,
      range: outcome.reconciled.range,
    });
  }
  await publishStamped(
    roomKey,
    (streamId) => ({
      type: "update",
      worktreeId,
      path,
      update,
      revision: outcome.revision ?? "pending",
      actorId: connection.user.id,
      streamId,
    }),
    connection,
  );
}

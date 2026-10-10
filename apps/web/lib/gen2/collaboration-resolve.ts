import "server-only";

import * as Y from "yjs";

import {
  decodeBase64,
  docFromUpdate,
  encodeBase64,
  encodedDocument,
  replaceDocumentContents,
} from "../collaboration/yjs-document";
import { sendError, type Connection } from "./collaboration-connection";
import { withDocumentLock } from "./collaboration-redis";
import { publish } from "./collaboration-rooms";
import { loadGen2Document, saveGen2Document } from "./collaboration-documents";
import { gen2CollaborationRoom } from "./collaboration-events";
import { readGen2SupersetFile, saveGen2SupersetFile } from "./superset";
import { requireGen2Member } from "./workspaces";

const LOCK_WAIT_MS = 10_000;

type Target = { workspaceId: string; worktreeId: string; path: string };
type Resolved = { revision: string; update: string | null } | null;

/** The editors' text wins: it overwrites the file as it is now. */
async function keepEditor(target: Target, userId: string): Promise<Resolved> {
  const snapshot = await loadGen2Document(
    target.workspaceId,
    target.worktreeId,
    target.path,
  );
  if (!snapshot) return null;
  const file = await readGen2SupersetFile(
    target.workspaceId,
    userId,
    target.worktreeId,
    target.path,
  );
  const contents = docFromUpdate(snapshot.update).getText("content").toString();
  const saved = await saveGen2SupersetFile(target.workspaceId, userId, {
    ...target,
    contents,
    expectedRevision: file.revision,
  });
  return { revision: saved.revision, update: null };
}

/** The file wins: the shared text becomes what is on disk. */
async function keepWorkspace(
  target: Target,
  userId: string,
): Promise<Resolved> {
  const snapshot = await loadGen2Document(
    target.workspaceId,
    target.worktreeId,
    target.path,
  );
  if (!snapshot) return null;
  const file = await readGen2SupersetFile(
    target.workspaceId,
    userId,
    target.worktreeId,
    target.path,
  );
  const doc = docFromUpdate(snapshot.update);
  replaceDocumentContents(doc, file.contents);
  await saveGen2Document({
    ...snapshot,
    ...encodedDocument(doc),
    revision: file.revision,
    filesystemContents: file.contents,
    filesystemRevision: file.revision,
  });
  const delta = Y.encodeStateAsUpdate(doc, decodeBase64(snapshot.stateVector));
  return { revision: file.revision, update: encodeBase64(delta) };
}

/**
 * Ends a shared-document conflict the way a member chose. Either way the
 * document and the file agree again and every editor leaves conflict state.
 */
export async function resolveConflict(
  workspaceId: string,
  connection: Connection,
  path: string,
  keep: "editor" | "workspace",
) {
  const worktreeId = connection.worktreeId;
  const membership = await requireGen2Member(workspaceId, connection.user.id);
  if (!worktreeId || membership.role === "viewer") {
    sendError(
      connection,
      "forbidden",
      "Only editors can resolve this.",
      false,
      path,
    );
    return;
  }
  const target = { workspaceId, worktreeId, path };
  const result = await withDocumentLock(
    gen2CollaborationRoom(workspaceId),
    worktreeId,
    path,
    () =>
      keep === "editor"
        ? keepEditor(target, connection.user.id)
        : keepWorkspace(target, connection.user.id),
    { waitMs: LOCK_WAIT_MS },
  );
  if (!result) return;
  await publish(gen2CollaborationRoom(workspaceId), {
    type: "reconciled",
    worktreeId,
    path,
    revision: result.revision,
    source: keep === "editor" ? "collaboration" : "filesystem",
    ...(result.update ? { update: result.update } : {}),
    actor: { kind: "user", userId: connection.user.id },
  });
}

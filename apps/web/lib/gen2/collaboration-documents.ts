import "server-only";

import { schema } from "@codev/db";
import { and, eq, inArray } from "drizzle-orm";
import * as Y from "yjs";

import {
  classifyFilesystemReconciliation,
  decodeBase64,
  docFromUpdate,
  encodeBase64,
  encodedDocument,
  mergeDocumentContents,
  replaceDocumentContents,
} from "../collaboration/yjs-document";
import { getDatabase } from "../platform/database";
import { readGen2SupersetFile } from "./superset";

export interface Gen2DocumentSnapshot {
  workspaceId: string;
  worktreeId: string;
  path: string;
  revision: string;
  update: string;
  stateVector: string;
  filesystemContents: string;
  filesystemRevision: string | null;
  hasConflict: boolean;
  conflictFilesystemRevision: string | null;
}

const snapshotColumns = {
  workspaceId: schema.gen2YjsDocuments.workspaceId,
  worktreeId: schema.gen2YjsDocuments.worktreeId,
  path: schema.gen2YjsDocuments.path,
  revision: schema.gen2YjsDocuments.revision,
  update: schema.gen2YjsDocuments.update,
  stateVector: schema.gen2YjsDocuments.stateVector,
  filesystemContents: schema.gen2YjsDocuments.filesystemContents,
  filesystemRevision: schema.gen2YjsDocuments.filesystemRevision,
  hasConflict: schema.gen2YjsDocuments.hasConflict,
  conflictFilesystemRevision:
    schema.gen2YjsDocuments.conflictFilesystemRevision,
};

export async function loadGen2Document(
  workspaceId: string,
  worktreeId: string,
  path: string,
): Promise<Gen2DocumentSnapshot | null> {
  const [snapshot] = await loadGen2Documents(workspaceId, worktreeId, [path]);
  return snapshot ?? null;
}

/** The shared documents that exist for `paths`, in one query. */
export async function loadGen2Documents(
  workspaceId: string,
  worktreeId: string,
  paths: string[],
): Promise<Gen2DocumentSnapshot[]> {
  if (!paths.length) return [];
  return getDatabase()
    .select(snapshotColumns)
    .from(schema.gen2YjsDocuments)
    .where(
      and(
        eq(schema.gen2YjsDocuments.workspaceId, workspaceId),
        eq(schema.gen2YjsDocuments.worktreeId, worktreeId),
        inArray(schema.gen2YjsDocuments.path, [...new Set(paths)]),
      ),
    );
}

export async function saveGen2Document(
  snapshot: Gen2DocumentSnapshot,
  conflictFilesystemRevision: string | null = null,
) {
  const now = new Date();
  await getDatabase()
    .insert(schema.gen2YjsDocuments)
    .values({
      ...snapshot,
      lastSyncedAt: conflictFilesystemRevision ? null : now,
      hasConflict: Boolean(conflictFilesystemRevision),
      conflictFilesystemRevision,
      conflictDetectedAt: conflictFilesystemRevision ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.gen2YjsDocuments.workspaceId,
        schema.gen2YjsDocuments.worktreeId,
        schema.gen2YjsDocuments.path,
      ],
      set: {
        revision: snapshot.revision,
        update: snapshot.update,
        stateVector: snapshot.stateVector,
        filesystemContents: snapshot.filesystemContents,
        filesystemRevision: snapshot.filesystemRevision,
        lastSyncedAt: conflictFilesystemRevision ? null : now,
        hasConflict: Boolean(conflictFilesystemRevision),
        conflictFilesystemRevision,
        conflictDetectedAt: conflictFilesystemRevision ? now : null,
        updatedAt: now,
      },
    });
}

export async function initializeGen2Document(
  workspaceId: string,
  userId: string,
  worktreeId: string,
  path: string,
) {
  const file = await readGen2SupersetFile(
    workspaceId,
    userId,
    worktreeId,
    path,
  );
  const doc = new Y.Doc();
  doc.getText("content").insert(0, file.contents);
  const snapshot: Gen2DocumentSnapshot = {
    workspaceId,
    worktreeId,
    path,
    revision: file.revision,
    ...encodedDocument(doc),
    filesystemContents: file.contents,
    filesystemRevision: file.revision,
    hasConflict: false,
    conflictFilesystemRevision: null,
  };
  await saveGen2Document(snapshot);
  return snapshot;
}

/** Records a completed revision-checked filesystem save without replacing a newer Yjs edit. */
export async function recordGen2DocumentSave(input: {
  workspaceId: string;
  worktreeId: string;
  path: string;
  contents: string;
  revision: string;
}) {
  const snapshot = await loadGen2Document(
    input.workspaceId,
    input.worktreeId,
    input.path,
  );
  if (!snapshot) return;
  await saveGen2Document({
    ...snapshot,
    revision: input.revision,
    filesystemContents: input.contents,
    filesystemRevision: input.revision,
    hasConflict: false,
    conflictFilesystemRevision: null,
  });
}

/**
 * Checks the shared document against the durable file without changing it.
 * Callers decide whether an agent-originated change should be broadcast.
 */
export async function reconcileGen2Document(
  workspaceId: string,
  userId: string,
  snapshot: Gen2DocumentSnapshot,
) {
  const file = await readGen2SupersetFile(
    workspaceId,
    userId,
    snapshot.worktreeId,
    snapshot.path,
  );
  const previousRevision = snapshot.filesystemRevision ?? snapshot.revision;
  if (snapshot.hasConflict) {
    return {
      snapshot,
      event: {
        type: "conflict" as const,
        path: snapshot.path,
        snapshotRevision: snapshot.revision,
        filesystemRevision:
          snapshot.conflictFilesystemRevision ?? file.revision,
      },
    };
  }

  const doc = docFromUpdate(snapshot.update);
  const reconciliation = classifyFilesystemReconciliation({
    snapshotContents: snapshot.filesystemContents,
    collaborativeContents: doc.getText("content").toString(),
    snapshotRevision: previousRevision,
    filesystemRevision: file.revision,
  });
  if (reconciliation === "unchanged") return { snapshot, event: null };

  // A file change over unsaved shared edits merges when the lines differ.
  const ranges =
    reconciliation === "conflict"
      ? mergeDocumentContents(doc, snapshot.filesystemContents, file.contents)
      : replaceDocumentContents(doc, file.contents);
  if (!ranges) {
    await saveGen2Document(snapshot, file.revision);
    return {
      snapshot: { ...snapshot, hasConflict: true },
      event: {
        type: "conflict" as const,
        path: snapshot.path,
        snapshotRevision: previousRevision,
        filesystemRevision: file.revision,
      },
    };
  }
  const delta = Y.encodeStateAsUpdate(doc, decodeBase64(snapshot.stateVector));
  const reconciled: Gen2DocumentSnapshot = {
    ...snapshot,
    ...encodedDocument(doc),
    revision: file.revision,
    filesystemContents: file.contents,
    filesystemRevision: file.revision,
    hasConflict: false,
    conflictFilesystemRevision: null,
  };
  await saveGen2Document(reconciled);
  return {
    snapshot: reconciled,
    event: {
      type: "reconciled" as const,
      path: snapshot.path,
      revision: file.revision,
      // Only what changed: clients already hold the previous state.
      update: encodeBase64(delta),
      range: ranges.length
        ? { from: ranges[0]!.from, to: ranges[ranges.length - 1]!.to }
        : undefined,
      /** Merged text the workspace file does not have yet. */
      needsWrite: reconciliation === "conflict",
    },
  };
}

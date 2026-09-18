import "server-only";

import { createHash } from "node:crypto";

import { schema } from "@codev/db";
import { and, eq } from "drizzle-orm";
import * as Y from "yjs";

import { getDatabase } from "@/lib/platform/database";
import { readSandboxFile } from "@/lib/runtime/orchestrator";

export interface Snapshot {
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

export function classifyFilesystemReconciliation(input: {
  snapshotContents: string;
  collaborativeContents: string;
  snapshotRevision: string;
  filesystemRevision: string;
}) {
  if (input.snapshotRevision === input.filesystemRevision) {
    return "unchanged" as const;
  }
  return input.collaborativeContents === input.snapshotContents
    ? ("ingest" as const)
    : ("conflict" as const);
}

export function collaborativeConflictRevision(contents: string): string {
  return `editor-${createHash("sha256").update(contents).digest("hex").slice(0, 24)}`;
}

export function decodeBase64(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

export function encodeBase64(value: Uint8Array) {
  return Buffer.from(value).toString("base64");
}

export function docFromUpdate(update: string) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, decodeBase64(update), "snapshot");
  return doc;
}

export function replaceDocumentContents(doc: Y.Doc, contents: string) {
  const text = doc.getText("content");
  doc.transact(() => {
    text.delete(0, text.length);
    text.insert(0, contents);
  }, "filesystem");
}

export function encodedDocument(doc: Y.Doc) {
  return {
    update: encodeBase64(Y.encodeStateAsUpdate(doc)),
    stateVector: encodeBase64(Y.encodeStateVector(doc)),
  };
}

export async function resolveWorktree(workspaceId: string, requested?: string) {
  const conditions = [
    eq(schema.worktrees.workspaceId, workspaceId),
    eq(schema.worktrees.status, "active"),
  ];
  if (requested) conditions.push(eq(schema.worktrees.id, requested));
  else conditions.push(eq(schema.worktrees.kind, "integration"));

  const [worktree] = await getDatabase()
    .select({ id: schema.worktrees.id })
    .from(schema.worktrees)
    .where(and(...conditions))
    .limit(1);
  return worktree?.id ?? null;
}

export async function sandboxWorktreeScope(worktreeId: string) {
  const [worktree] = await getDatabase()
    .select({ kind: schema.worktrees.kind })
    .from(schema.worktrees)
    .where(eq(schema.worktrees.id, worktreeId))
    .limit(1);
  if (!worktree) throw new Error("Worktree not found.");
  return worktree.kind === "agent" ? worktreeId : undefined;
}

export async function loadSnapshot(worktreeId: string, path: string) {
  const [snapshot] = await getDatabase()
    .select({
      worktreeId: schema.yjsSnapshots.worktreeId,
      path: schema.yjsSnapshots.path,
      revision: schema.yjsSnapshots.revision,
      update: schema.yjsSnapshots.update,
      stateVector: schema.yjsSnapshots.stateVector,
      filesystemContents: schema.yjsSnapshots.filesystemContents,
      filesystemRevision: schema.yjsSnapshots.filesystemRevision,
      hasConflict: schema.yjsSnapshots.hasConflict,
      conflictFilesystemRevision:
        schema.yjsSnapshots.conflictFilesystemRevision,
    })
    .from(schema.yjsSnapshots)
    .where(
      and(
        eq(schema.yjsSnapshots.worktreeId, worktreeId),
        eq(schema.yjsSnapshots.path, path),
      ),
    )
    .limit(1);
  return snapshot ?? null;
}

export async function saveSnapshot(
  snapshot: Snapshot,
  conflictFilesystemRevision: string | null = null,
) {
  const now = new Date();
  await getDatabase()
    .insert(schema.yjsSnapshots)
    .values({
      ...snapshot,
      lastSyncedAt: conflictFilesystemRevision ? null : now,
      hasConflict: Boolean(conflictFilesystemRevision),
      conflictFilesystemRevision,
      conflictDetectedAt: conflictFilesystemRevision ? now : null,
      conflictResolvedAt: null,
      conflictResolvedBy: null,
      conflictResolution: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.yjsSnapshots.worktreeId, schema.yjsSnapshots.path],
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
        conflictResolvedAt: null,
        conflictResolvedBy: null,
        conflictResolution: null,
        updatedAt: now,
      },
    });
}

export async function initializeSnapshot(
  workspaceId: string,
  worktreeId: string,
  path: string,
) {
  const file = await readSandboxFile(
    workspaceId,
    path,
    await sandboxWorktreeScope(worktreeId),
  );
  const doc = new Y.Doc();
  doc.getText("content").insert(0, file.contents);
  const encoded = encodedDocument(doc);
  const snapshot: Snapshot = {
    worktreeId,
    path,
    revision: file.revision,
    ...encoded,
    filesystemContents: file.contents,
    filesystemRevision: file.revision,
    hasConflict: false,
    conflictFilesystemRevision: null,
  };
  await saveSnapshot(snapshot);
  return snapshot;
}

export async function reconcileSnapshot(
  workspaceId: string,
  snapshot: Snapshot,
) {
  const file = await readSandboxFile(
    workspaceId,
    snapshot.path,
    await sandboxWorktreeScope(snapshot.worktreeId),
  );
  const previousRevision = snapshot.filesystemRevision ?? snapshot.revision;
  if (snapshot.hasConflict) {
    return {
      snapshot,
      event: {
        type: "conflict" as const,
        worktreeId: snapshot.worktreeId,
        path: snapshot.path,
        snapshotRevision: snapshot.revision,
        filesystemRevision:
          snapshot.conflictFilesystemRevision ?? file.revision,
        message:
          "The collaborative document and sandbox file both changed. Neither version was overwritten.",
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
  if (reconciliation === "unchanged") {
    return { snapshot, event: null };
  }

  if (reconciliation === "conflict") {
    await saveSnapshot(snapshot, file.revision);
    return {
      snapshot,
      event: {
        type: "conflict" as const,
        worktreeId: snapshot.worktreeId,
        path: snapshot.path,
        snapshotRevision: previousRevision,
        filesystemRevision: file.revision,
        message:
          "The collaborative document and sandbox file both changed. Neither version was overwritten.",
      },
    };
  }

  replaceDocumentContents(doc, file.contents);
  const encoded = encodedDocument(doc);
  const reconciled: Snapshot = {
    ...snapshot,
    ...encoded,
    revision: file.revision,
    filesystemRevision: file.revision,
    filesystemContents: file.contents,
    hasConflict: false,
    conflictFilesystemRevision: null,
  };
  await saveSnapshot(reconciled);
  return {
    snapshot: reconciled,
    event: {
      type: "reconciled" as const,
      worktreeId: snapshot.worktreeId,
      path: snapshot.path,
      revision: file.revision,
      source: "filesystem" as const,
      update: encoded.update,
    },
  };
}

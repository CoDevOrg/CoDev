import "server-only";

import {
  conflictReportInputSchema,
  conflictResolutionInputSchema,
  type ConflictReportInput,
  type ConflictResolutionInput,
} from "@codev/contracts";
import { schema } from "@codev/db";
import { and, eq } from "drizzle-orm";
import * as Y from "yjs";

import { getDatabase } from "@/lib/platform/database";
import { readSandboxFile, writeSandboxFile } from "@/lib/runtime/orchestrator";

import {
  collaborativeConflictRevision,
  docFromUpdate,
  encodedDocument,
  loadSnapshot,
  replaceDocumentContents,
  resolveWorktree,
  sandboxWorktreeScope,
  saveSnapshot,
} from "./collaboration-documents";
import { withDocumentLock } from "./collaboration-redis";
import { publish } from "./collaboration-rooms";

export type CollaborationConflict = {
  worktreeId: string;
  path: string;
  snapshotRevision: string;
  filesystemRevision: string;
  collaborativeContents: string;
  filesystemContents: string;
};

export class CollaborationConflictResolutionError extends Error {
  readonly status = 409;
}

const PRESERVED_CONFLICT_MESSAGE =
  "The collaborative document and sandbox file both changed. Neither version was overwritten.";

/**
 * Returns unresolved integration-checkout conflicts with both preserved text
 * versions. This is deliberately server-side: Orca gets authorized workspace
 * file contents, never a sandbox credential or filesystem handle.
 */
export async function listCollaborationConflicts(
  workspaceId: string,
): Promise<CollaborationConflict[]> {
  const worktreeId = await resolveWorktree(workspaceId);
  if (!worktreeId) return [];

  const snapshots = await getDatabase()
    .select({
      path: schema.yjsSnapshots.path,
      revision: schema.yjsSnapshots.revision,
      update: schema.yjsSnapshots.update,
      conflictFilesystemRevision:
        schema.yjsSnapshots.conflictFilesystemRevision,
    })
    .from(schema.yjsSnapshots)
    .where(
      and(
        eq(schema.yjsSnapshots.worktreeId, worktreeId),
        eq(schema.yjsSnapshots.hasConflict, true),
      ),
    )
    .orderBy(schema.yjsSnapshots.path);

  return Promise.all(
    snapshots.map(async (snapshot) => {
      const file = await readSandboxFile(workspaceId, snapshot.path);
      return {
        worktreeId,
        path: snapshot.path,
        snapshotRevision: snapshot.revision,
        filesystemRevision:
          snapshot.conflictFilesystemRevision ?? file.revision,
        collaborativeContents: docFromUpdate(snapshot.update)
          .getText("content")
          .toString(),
        filesystemContents: file.contents,
      };
    }),
  );
}

export async function reportCollaborationConflict(
  workspaceId: string,
  rawInput: unknown,
): Promise<CollaborationConflict> {
  const input: ConflictReportInput = conflictReportInputSchema.parse(rawInput);
  const worktreeId = await resolveWorktree(workspaceId, input.worktreeId);
  if (!worktreeId) throw new Error("Active worktree not found.");

  const conflict = await withDocumentLock(
    workspaceId,
    worktreeId,
    input.path,
    async () => {
      const file = await readSandboxFile(
        workspaceId,
        input.path,
        await sandboxWorktreeScope(worktreeId),
      );
      const loaded = await loadSnapshot(worktreeId, input.path);
      const collaborativeContents = input.collaborativeContents;
      if (
        loaded?.hasConflict &&
        loaded.conflictFilesystemRevision === file.revision &&
        docFromUpdate(loaded.update).getText("content").toString() ===
          collaborativeContents
      ) {
        return {
          worktreeId,
          path: input.path,
          snapshotRevision: loaded.revision,
          filesystemRevision: file.revision,
          collaborativeContents,
          filesystemContents: file.contents,
        };
      }

      const doc = new Y.Doc();
      doc.getText("content").insert(0, collaborativeContents);
      const encoded = encodedDocument(doc);
      const snapshotRevision =
        loaded &&
        docFromUpdate(loaded.update).getText("content").toString() ===
          collaborativeContents
          ? loaded.revision
          : collaborativeConflictRevision(collaborativeContents);
      await saveSnapshot(
        {
          worktreeId,
          path: input.path,
          revision: snapshotRevision,
          ...encoded,
          filesystemContents:
            loaded?.filesystemContents ?? collaborativeContents,
          filesystemRevision: loaded?.filesystemRevision ?? null,
          hasConflict: true,
          conflictFilesystemRevision: file.revision,
        },
        file.revision,
      );
      return {
        worktreeId,
        path: input.path,
        snapshotRevision,
        filesystemRevision: file.revision,
        collaborativeContents,
        filesystemContents: file.contents,
      };
    },
  );
  await publish(workspaceId, {
    type: "conflict",
    worktreeId,
    path: input.path,
    snapshotRevision: conflict.snapshotRevision,
    filesystemRevision: conflict.filesystemRevision,
    message: PRESERVED_CONFLICT_MESSAGE,
  });
  return conflict;
}

export async function resolveCollaborationConflict(
  workspaceId: string,
  userId: string,
  rawInput: unknown,
) {
  const input: ConflictResolutionInput =
    conflictResolutionInputSchema.parse(rawInput);
  const worktreeId = await resolveWorktree(workspaceId, input.worktreeId);
  if (!worktreeId) throw new Error("Active worktree not found.");

  const result = await withDocumentLock(
    workspaceId,
    worktreeId,
    input.path,
    async () => {
      const snapshot = await loadSnapshot(worktreeId, input.path);
      if (!snapshot?.hasConflict) {
        throw new CollaborationConflictResolutionError(
          "No persistent collaboration conflict exists for this document.",
        );
      }
      if (snapshot.revision !== input.expectedSnapshotRevision) {
        throw new CollaborationConflictResolutionError(
          "The collaboration snapshot changed before resolution.",
        );
      }
      const sandboxWorktreeId = await sandboxWorktreeScope(worktreeId);
      const file = await readSandboxFile(
        workspaceId,
        input.path,
        sandboxWorktreeId,
      );
      if (file.revision !== input.expectedFilesystemRevision) {
        throw new CollaborationConflictResolutionError(
          "The filesystem changed before resolution.",
        );
      }

      const doc = docFromUpdate(snapshot.update);
      let contents = doc.getText("content").toString();
      if (input.strategy === "filesystem") {
        contents = file.contents;
        replaceDocumentContents(doc, contents);
      } else if (input.strategy === "merged") {
        contents = input.mergedContents ?? "";
        replaceDocumentContents(doc, contents);
      }
      let resultRevision = file.revision;
      if (input.strategy !== "filesystem") {
        const written = await writeSandboxFile(workspaceId, {
          path: input.path,
          contents,
          expectedRevision: file.revision,
          ...(sandboxWorktreeId ? { worktreeId: sandboxWorktreeId } : {}),
        });
        resultRevision = written.revision;
      }
      const encoded = encodedDocument(doc);
      const now = new Date();
      await getDatabase().transaction(async (transaction) => {
        const [resolved] = await transaction
          .update(schema.yjsSnapshots)
          .set({
            revision: resultRevision,
            update: encoded.update,
            stateVector: encoded.stateVector,
            filesystemContents: contents,
            filesystemRevision: resultRevision,
            lastSyncedAt: now,
            hasConflict: false,
            conflictFilesystemRevision: null,
            conflictResolvedAt: now,
            conflictResolvedBy: userId,
            conflictResolution: input.strategy,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.yjsSnapshots.worktreeId, worktreeId),
              eq(schema.yjsSnapshots.path, input.path),
              eq(schema.yjsSnapshots.hasConflict, true),
              eq(schema.yjsSnapshots.revision, input.expectedSnapshotRevision),
            ),
          )
          .returning({ id: schema.yjsSnapshots.id });
        if (!resolved) {
          throw new CollaborationConflictResolutionError(
            "The conflict was resolved by another request.",
          );
        }
        await transaction
          .insert(schema.collaborationConflictResolutions)
          .values({
            worktreeId,
            path: input.path,
            resolvedBy: userId,
            strategy: input.strategy,
            snapshotRevision: input.expectedSnapshotRevision,
            filesystemRevision: input.expectedFilesystemRevision,
            resultRevision,
          });
      });
      return {
        revision: resultRevision,
        strategy: input.strategy,
        update: encoded.update,
      };
    },
  );
  await publish(workspaceId, {
    type: "reconciled",
    worktreeId,
    path: input.path,
    revision: result.revision,
    source: result.strategy === "filesystem" ? "filesystem" : "collaboration",
    update: result.update,
  });
  return { revision: result.revision, strategy: result.strategy };
}

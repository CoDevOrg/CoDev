import "server-only";

import { publish } from "../workspaces/collaboration-rooms";
import {
  loadGen2Document,
  reconcileGen2Document,
} from "./collaboration-documents";

/** One workspace room carries events for all worktrees; fan-out filters them. */
export function gen2CollaborationRoom(workspaceId: string) {
  return `gen2:${workspaceId}`;
}

/**
 * Reconciles only documents that are actually open in a shared editor. Codex
 * file-change events call this instead of making every browser poll the guest
 * filesystem.
 */
export async function reconcileGen2CollaborationPaths(input: {
  workspaceId: string;
  userId: string;
  worktreeId?: string;
  paths: string[];
}) {
  const worktreeId = input.worktreeId ?? "main";
  for (const path of [...new Set(input.paths)]) {
    const snapshot = await loadGen2Document(
      input.workspaceId,
      worktreeId,
      path,
    );
    if (!snapshot) continue;
    const result = await reconcileGen2Document(
      input.workspaceId,
      input.userId,
      snapshot,
    );
    if (!result.event) continue;
    if (result.event.type === "reconciled") {
      await publish(gen2CollaborationRoom(input.workspaceId), {
        type: "reconciled",
        worktreeId,
        path: result.event.path,
        revision: result.event.revision,
        source: "filesystem",
        update: result.event.update,
      });
    } else {
      await publish(gen2CollaborationRoom(input.workspaceId), {
        type: "conflict",
        worktreeId,
        path: result.event.path,
        snapshotRevision: result.event.snapshotRevision,
        filesystemRevision: result.event.filesystemRevision,
        message:
          "An agent changed this file while collaborative edits were pending. Neither version was overwritten.",
      });
    }
  }
}

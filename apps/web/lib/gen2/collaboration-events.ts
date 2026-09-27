import "server-only";

import { publish } from "../workspaces/collaboration-rooms";
import {
  loadGen2Document,
  reconcileGen2Document,
} from "./collaboration-documents";

/** Redis room namespace; unlike Gen 1 it never identifies a worktree. */
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
  paths: string[];
}) {
  for (const path of [...new Set(input.paths)]) {
    const snapshot = await loadGen2Document(input.workspaceId, path);
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
        // The shared collaboration wire format predates Gen 2. This carries
        // the workspace ID solely for per-document event filtering; it is not
        // looked up as a Gen 1 worktree.
        worktreeId: input.workspaceId,
        path: result.event.path,
        revision: result.event.revision,
        source: "filesystem",
        update: result.event.update,
      });
    } else {
      await publish(gen2CollaborationRoom(input.workspaceId), {
        type: "conflict",
        worktreeId: input.workspaceId,
        path: result.event.path,
        snapshotRevision: result.event.snapshotRevision,
        filesystemRevision: result.event.filesystemRevision,
        message:
          "An agent changed this file while collaborative edits were pending. Neither version was overwritten.",
      });
    }
  }
}

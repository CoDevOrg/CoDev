import "server-only";

import type { Gen2RealtimeActor } from "@codev/contracts";

import { publish } from "./collaboration-rooms";
import { DocumentBusyError, withDocumentLock } from "./collaboration-redis";
import {
  loadGen2Document,
  loadGen2Documents,
  reconcileGen2Document,
} from "./collaboration-documents";
import { logEvent } from "../platform/observability";
import { announceWrite, writeSharedFile } from "./collaboration-autosave";

/** Waits out a member's in-flight edit instead of skipping the agent's. */
const LOCK_WAIT_MS = 5_000;

/** One workspace room carries events for all worktrees; fan-out filters them. */
export function gen2CollaborationRoom(workspaceId: string) {
  return `gen2:${workspaceId}`;
}

/**
 * Reconciles only documents that are open in a shared editor (found in one
 * query). Agent file-change events call this instead of making every browser
 * poll the guest filesystem. Returns each reconciled path's changed span.
 */
export async function reconcileGen2CollaborationPaths(input: {
  workspaceId: string;
  userId: string;
  worktreeId: string;
  paths: string[];
  actor?: Gen2RealtimeActor;
}) {
  const room = gen2CollaborationRoom(input.workspaceId);
  const snapshots = await loadGen2Documents(
    input.workspaceId,
    input.worktreeId,
    input.paths,
  );
  const ranges = new Map<string, { from: number; to: number }>();
  for (const snapshot of snapshots) {
    const result = await withDocumentLock(
      room,
      input.worktreeId,
      snapshot.path,
      async () => {
        // Re-read under the lock so a member edit saved meanwhile is kept.
        const current = await loadGen2Document(
          input.workspaceId,
          input.worktreeId,
          snapshot.path,
        );
        if (!current) return null;
        const reconciled = await reconcileGen2Document(
          input.workspaceId,
          input.userId,
          current,
        );
        // A merge with a member's edits goes to disk at once.
        const written =
          reconciled.event?.type === "reconciled" && reconciled.event.needsWrite
            ? await writeSharedFile(
                { ...input, path: snapshot.path },
                input.userId,
              )
            : null;
        return { ...reconciled, written };
      },
      { waitMs: LOCK_WAIT_MS },
    ).catch((error) => {
      // Still busy after waiting: the turn's final reconcile retries it.
      if (!(error instanceof DocumentBusyError)) throw error;
      logEvent("info", "gen2.collaboration.reconcile_skipped", {
        path: snapshot.path,
      });
      return null;
    });
    if (!result?.event) continue;
    if (result.event.type === "reconciled") {
      if (result.event.range) ranges.set(snapshot.path, result.event.range);
      await publish(room, {
        type: "reconciled",
        worktreeId: input.worktreeId,
        path: result.event.path,
        revision: result.event.revision,
        source: "filesystem",
        update: result.event.update,
        actor: input.actor,
        range: result.event.range,
      });
      await announceWrite({ ...input, path: snapshot.path }, result.written);
    } else {
      await publish(room, {
        type: "conflict",
        worktreeId: input.worktreeId,
        path: result.event.path,
        snapshotRevision: result.event.snapshotRevision,
        filesystemRevision: result.event.filesystemRevision,
        message:
          "An agent changed the same lines you were editing. Choose which version to keep.",
      });
    }
  }
  return ranges;
}

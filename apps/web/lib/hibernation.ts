import "server-only";

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import {
  discardSandboxSnapshot,
  destroySandbox,
  resumeSandbox,
  snapshotWorkspace,
  stopIde,
} from "./orchestrator";
import { getDatabase } from "./database";
import { hasLiveWorkspaceHeartbeat } from "./heartbeat";
import { closeSandboxInterval } from "./vm-usage";
import { workspaceRuntimeTtlMs } from "./workspaces";

export const E2B_LIFECYCLE_OPTIONS = {
  timeoutMs: 14_400_000,
  lifecycle: { onTimeout: "pause", autoResume: true },
} as const;

export class WorkspaceHibernationError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "WorkspaceHibernationError";
  }
}

export async function getWorkspaceSnapshot(workspaceId: string) {
  const [snapshot] = await getDatabase()
    .select()
    .from(schema.workspaceSnapshots)
    .where(eq(schema.workspaceSnapshots.workspaceId, workspaceId))
    .limit(1);
  return snapshot;
}

export function listSnapshotFiles(
  snapshot: NonNullable<Awaited<ReturnType<typeof getWorkspaceSnapshot>>>,
) {
  return snapshot.snapshot.files.map((file) => ({
    path: file.path,
    status: "M",
  }));
}

export function readSnapshotFile(
  snapshot: NonNullable<Awaited<ReturnType<typeof getWorkspaceSnapshot>>>,
  path: string,
) {
  const file = snapshot.snapshot.files.find(
    (candidate) => candidate.path === path,
  );
  if (!file) return null;
  const bytes = Buffer.from(file.contentBase64, "base64");
  const contents = bytes.toString("utf8");
  return {
    path: file.path,
    contents,
    revision: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function clearWorkspaceSnapshot(workspaceId: string) {
  await getDatabase()
    .delete(schema.workspaceSnapshots)
    .where(eq(schema.workspaceSnapshots.workspaceId, workspaceId));
}

async function abortPausedSnapshot(workspaceId: string) {
  // The persisted Firecracker block-device files are linked to the paused VM
  // until hibernation commits. Remove them before resuming so guest writes
  // cannot mutate the only recovery copy.
  await discardSandboxSnapshot(workspaceId);
  // The Rust snapshot path resumes the VM itself when Firecracker fails while
  // creating the snapshot. Resuming again is therefore intentionally
  // idempotent: an already-running VM may return a conflict, and a VM that
  // disappeared may return 404 (both are safe after its snapshot links were
  // discarded).
  await resumeSandbox(workspaceId).catch(() => undefined);
}

export async function hibernateWorkspace(workspaceId: string) {
  const [state] = await getDatabase()
    .select({
      workspaceStatus: schema.workspaces.status,
      integrationHeadSha: schema.worktrees.headSha,
      runtimeStatus: schema.workspaceRuntimes.status,
      sandboxId: schema.workspaceRuntimes.sandboxId,
    })
    .from(schema.workspaces)
    .innerJoin(
      schema.workspaceRuntimes,
      eq(schema.workspaceRuntimes.workspaceId, schema.workspaces.id),
    )
    .innerJoin(
      schema.worktrees,
      and(
        eq(schema.worktrees.workspaceId, schema.workspaces.id),
        eq(schema.worktrees.kind, "integration"),
      ),
    )
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);

  if (!state) throw new WorkspaceHibernationError("Workspace not found.", 404);
  if (state.runtimeStatus !== "ready" || !state.sandboxId) return false;
  if (state.workspaceStatus !== "ready") return false;
  if (await hasLiveWorkspaceHeartbeat(workspaceId)) return false;

  // Claim the runtime before doing any slow guest I/O. This prevents a second
  // lifecycle run from snapshotting the same VM and prevents resume/mutation
  // requests from racing with the only authoritative filesystem snapshot.
  const claimed = await getDatabase().transaction(async (transaction) => {
    const [current] = await transaction
      .select({
        workspaceStatus: schema.workspaces.status,
        runtimeStatus: schema.workspaceRuntimes.status,
      })
      .from(schema.workspaces)
      .innerJoin(
        schema.workspaceRuntimes,
        eq(schema.workspaceRuntimes.workspaceId, schema.workspaces.id),
      )
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1)
      .for("update");
    if (
      !current ||
      current.workspaceStatus !== "ready" ||
      current.runtimeStatus !== "ready"
    ) {
      return false;
    }
    const now = new Date();
    await transaction
      .update(schema.workspaceRuntimes)
      .set({ status: "stopping", updatedAt: now })
      .where(eq(schema.workspaceRuntimes.workspaceId, workspaceId));
    await transaction
      .update(schema.workspaces)
      .set({ status: "stopping", updatedAt: now })
      .where(eq(schema.workspaces.id, workspaceId));
    return true;
  });
  if (!claimed) return false;

  const releaseClaim = async () => {
    const now = new Date();
    await getDatabase().transaction(async (transaction) => {
      await transaction
        .update(schema.workspaceRuntimes)
        .set({ status: "ready", updatedAt: now })
        .where(
          and(
            eq(schema.workspaceRuntimes.workspaceId, workspaceId),
            eq(schema.workspaceRuntimes.status, "stopping"),
          ),
        );
      await transaction
        .update(schema.workspaces)
        .set({
          status: "ready",
          hibernateAt: new Date(now.getTime() + workspaceRuntimeTtlMs),
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.workspaces.id, workspaceId),
            eq(schema.workspaces.status, "stopping"),
          ),
        );
    });
  };

  let snapshot: Awaited<ReturnType<typeof snapshotWorkspace>>;
  try {
    snapshot = await snapshotWorkspace(workspaceId, state.integrationHeadSha);
  } catch (error) {
    await abortPausedSnapshot(workspaceId);
    await releaseClaim().catch(() => undefined);
    throw error;
  }
  if (snapshot.headSha !== state.integrationHeadSha) {
    await abortPausedSnapshot(workspaceId);
    await releaseClaim().catch(() => undefined);
    throw new WorkspaceHibernationError(
      "The sandbox changed while its hibernation snapshot was created.",
    );
  }
  const now = new Date();
  try {
    await getDatabase()
      .insert(schema.workspaceSnapshots)
      .values({
        workspaceId,
        headSha: snapshot.headSha,
        snapshot: {
          files: snapshot.files.map((file) => ({
            path: file.path,
            mode: file.mode,
            contentBase64: file.contentBase64,
          })),
          totalBytes: snapshot.totalBytes,
        },
        totalBytes: snapshot.totalBytes,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.workspaceSnapshots.workspaceId,
        set: {
          headSha: snapshot.headSha,
          snapshot: {
            files: snapshot.files,
            totalBytes: snapshot.totalBytes,
          },
          totalBytes: snapshot.totalBytes,
          updatedAt: now,
        },
      });
  } catch (error) {
    await abortPausedSnapshot(workspaceId);
    await releaseClaim().catch(() => undefined);
    throw error;
  }

  // Snapshotting is asynchronous. A heartbeat, resume request, or merge may
  // have changed the workspace while the guest was being exported. Re-read
  // the control-plane state before destroying the only live sandbox; if it
  // changed, the snapshot is stale and must not become the source of truth.
  const [current] = await getDatabase()
    .select({
      workspaceStatus: schema.workspaces.status,
      integrationHeadSha: schema.worktrees.headSha,
      runtimeStatus: schema.workspaceRuntimes.status,
      sandboxId: schema.workspaceRuntimes.sandboxId,
    })
    .from(schema.workspaces)
    .innerJoin(
      schema.workspaceRuntimes,
      eq(schema.workspaceRuntimes.workspaceId, schema.workspaces.id),
    )
    .innerJoin(
      schema.worktrees,
      and(
        eq(schema.worktrees.workspaceId, schema.workspaces.id),
        eq(schema.worktrees.kind, "integration"),
      ),
    )
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (
    !current ||
    current.workspaceStatus !== "stopping" ||
    current.runtimeStatus !== "stopping" ||
    !current.sandboxId ||
    current.integrationHeadSha !== state.integrationHeadSha ||
    (await hasLiveWorkspaceHeartbeat(workspaceId))
  ) {
    await abortPausedSnapshot(workspaceId);
    await clearWorkspaceSnapshot(workspaceId);
    await releaseClaim();
    return false;
  }
  // The Firecracker snapshot covers the complete guest disk, RAM, running
  // processes, PTYs, and agent worktree directories. Agent sessions and
  // events are independently durable in PostgreSQL, so active agent
  // worktrees must not prevent scale-to-zero hibernation.
  try {
    await destroySandbox(workspaceId);
  } catch (error) {
    await abortPausedSnapshot(workspaceId);
    await clearWorkspaceSnapshot(workspaceId).catch(() => undefined);
    await releaseClaim().catch(() => undefined);
    throw error;
  }
  // Best-effort: an orphaned Orca IDE process is reclaimed by the
  // orchestrator's own idle-timeout reaper (services/orchestrator/src/backend/orca.rs)
  // even if this call fails, so it must not block hibernation on its result.
  await stopIde(workspaceId).catch(() => undefined);

  await closeSandboxInterval(workspaceId, "hibernate");
  await getDatabase().transaction(async (transaction) => {
    await transaction
      .update(schema.workspaceRuntimes)
      .set({
        sandboxId: null,
        status: "hibernated",
        snapshotRef: workspaceId,
        hibernatedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.workspaceRuntimes.workspaceId, workspaceId));
    await transaction
      .update(schema.workspaces)
      .set({ status: "hibernated", hibernateAt: null, updatedAt: now })
      .where(eq(schema.workspaces.id, workspaceId));
  });
  return true;
}

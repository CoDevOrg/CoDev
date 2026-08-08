import "server-only";

import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getRun } from "workflow/api";

import { schema } from "@codev/db";

import { appendWorkspaceEvent } from "./audit";
import { getDatabase } from "./database";
import { getHostState } from "./host";
import { logEvent } from "./observability";
import { destroySandbox } from "./orchestrator";
import { closeOrphanSandboxIntervals } from "./vm-usage";
import { markWorkspaceStopped } from "./workspaces";

async function cancelWorkspaceAgents(workspaceId: string) {
  const sessions = await getDatabase()
    .select({
      id: schema.agentSessions.id,
      workflowRunId: schema.agentSessions.workflowRunId,
    })
    .from(schema.agentSessions)
    .where(
      and(
        eq(schema.agentSessions.workspaceId, workspaceId),
        inArray(schema.agentSessions.status, ["idle", "running", "waiting"]),
      ),
    );
  const cancellationErrors: string[] = [];
  for (const session of sessions) {
    if (!session.workflowRunId) continue;
    try {
      await getRun(session.workflowRunId).cancel();
    } catch (error) {
      cancellationErrors.push(
        error instanceof Error ? error.name : "WorkflowCancellationError",
      );
    }
  }

  const now = new Date();
  await getDatabase().transaction(async (transaction) => {
    await transaction.execute(sql`
      update agent_turns
      set status = 'interrupted', finished_at = ${now}, updated_at = ${now},
          last_error = 'Workspace lifecycle cleanup interrupted this turn.'
      where session_id in (
        select id from agent_sessions where workspace_id = ${workspaceId}
      ) and status in ('queued', 'running')
    `);
    await transaction.execute(sql`
      update path_claims
      set status = 'expired', updated_at = ${now}
      where session_id in (
        select id from agent_sessions where workspace_id = ${workspaceId}
      ) and status in ('active', 'contested')
    `);
    await transaction
      .update(schema.agentSessions)
      .set({
        status: "interrupted",
        workflowRunId: null,
        interruptedAt: now,
        lastError: "Workspace lifecycle cleanup interrupted this session.",
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.agentSessions.workspaceId, workspaceId),
          inArray(schema.agentSessions.status, ["idle", "running", "waiting"]),
        ),
      );
    await transaction
      .update(schema.worktrees)
      .set({ status: "discarded", discardedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.worktrees.workspaceId, workspaceId),
          eq(schema.worktrees.kind, "agent"),
          inArray(schema.worktrees.status, ["active", "frozen"]),
        ),
      );
  });
  return cancellationErrors;
}

async function cleanupWorkspace(
  workspaceId: string,
  hostRunning: boolean,
  reason: "expired" | "runtime_missing",
) {
  const cancellationErrors = await cancelWorkspaceAgents(workspaceId);
  if (hostRunning) await destroySandbox(workspaceId);
  await markWorkspaceStopped(workspaceId);
  await appendWorkspaceEvent({
    workspaceId,
    type: "lifecycle.cleaned",
    payload: {
      reason,
      hostRunning,
      workflowCancellationFailures: cancellationErrors.length,
    },
  });
  return cancellationErrors.length;
}

export async function reconcileLifecycle() {
  const startedAt = Date.now();
  const hostState = await getHostState().catch((error) => {
    logEvent("warn", "lifecycle.host_unavailable", {
      error: error instanceof Error ? error.message : "unknown error",
    });
    return "unavailable" as const;
  });
  const hostRunning = hostState === "running";
  const now = new Date();
  const expired = await getDatabase()
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(
      and(
        lt(schema.workspaces.expiresAt, now),
        inArray(schema.workspaces.status, [
          "pending",
          "provisioning",
          "stopping",
        ]),
      ),
    )
    .limit(100);
  const targets = new Map<string, "expired" | "runtime_missing">();
  for (const workspace of expired) targets.set(workspace.id, "expired");

  // Automatic workspace hibernation is intentionally disabled. Workspaces
  // stay live until an explicit stop or cleanup operation is requested.
  let cancellationFailures = 0;
  for (const [workspaceId, reason] of targets) {
    cancellationFailures += await cleanupWorkspace(
      workspaceId,
      hostRunning,
      reason,
    );
  }
  await getDatabase()
    .update(schema.workspaceInvites)
    .set({ revokedAt: now })
    .where(
      and(
        lt(schema.workspaceInvites.expiresAt, now),
        sql`${schema.workspaceInvites.revokedAt} is null`,
        sql`${schema.workspaceInvites.acceptedAt} is null`,
      ),
    );
  await getDatabase()
    .delete(schema.workspaceEvents)
    .where(
      lt(
        schema.workspaceEvents.createdAt,
        new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000),
      ),
    );

  const orphanIntervalsClosed = await closeOrphanSandboxIntervals();

  const result = {
    hostState,
    cleaned: targets.size,
    hibernated: 0,
    hibernationFailures: 0,
    cancellationFailures,
    orphanIntervalsClosed,
    durationMs: Date.now() - startedAt,
  };
  logEvent("info", "lifecycle.reconciled", result);
  return result;
}

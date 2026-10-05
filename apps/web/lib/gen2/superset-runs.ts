import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { schema } from "@codev/db";
import type { Gen2SupersetRunStatus } from "@codev/contracts";

import { getDatabase } from "../platform/database";
import { Gen2LifecycleError } from "./errors";

/**
 * Durable run identity for a Gen 2 Superset terminal-agent session, per
 * docs/SUPERSET_AGENT_SESSION_PLAN.md Phase 1. CoDev owns this row as the
 * source of truth for identity, credential lease, and lifecycle state --
 * Superset's own SQLite database is never queried for it. No credential
 * material lives here, only a `connectionId` pointing at the existing
 * encrypted `provider_credentials` row.
 *
 * Callers are responsible for membership/role checks before calling any
 * mutating function here, matching the convention in `cli-agent-session.ts`.
 */

const SUPERSET_RUN_LOCK_PREFIX = "codev-gen2-superset-run:";

const MONITORABLE_STATUSES: Gen2SupersetRunStatus[] = [
  "creating",
  "running",
  "stopping",
];

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function lockSupersetRunWorkspace(
  transaction: Transaction,
  workspaceId: string,
) {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${SUPERSET_RUN_LOCK_PREFIX}${workspaceId}`}))`,
  );
}

export type Gen2SupersetRunAuditEventType =
  | "run_created"
  | "run_started"
  | "run_stopping"
  | "run_finished"
  | "run_failed"
  | "recovery_required"
  | "lease_claimed"
  | "lease_released";

/**
 * Append-only audit entry for a run's lease and lifecycle transitions. Takes
 * `transaction` so a call site can append atomically with the state change
 * that triggered it.
 */
async function recordGen2SupersetRunAuditEvent(
  transaction: Transaction,
  input: {
    runId: string;
    workspaceId: string;
    actorId?: string | null;
    type: Gen2SupersetRunAuditEventType;
    result: "success" | "failure";
  },
) {
  await transaction.insert(schema.gen2SupersetRunEvents).values({
    runId: input.runId,
    workspaceId: input.workspaceId,
    actorId: input.actorId ?? null,
    type: input.type,
    result: input.result,
  });
}

export type RegisterGen2SupersetRunInput = {
  sessionId?: string | null;
  workspaceId: string;
  chatId?: string | null;
  createdBy: string;
  worktreeId: string;
  provider: string;
  connectionId?: string | null;
  credentialRevision?: string | null;
  /** Retrying with the same key returns the existing run instead of a new one. */
  idempotencyKey: string;
};

/**
 * Idempotently create -- or return the existing -- run for one
 * `(workspaceId, idempotencyKey)` pair, so a client retry after a dropped
 * response resumes the same run instead of starting a second provider
 * process.
 */
export async function registerGen2SupersetRun(
  input: RegisterGen2SupersetRunInput,
): Promise<{ runId: string; status: Gen2SupersetRunStatus; created: boolean }> {
  const database = getDatabase();
  return database.transaction(async (transaction) => {
    await lockSupersetRunWorkspace(transaction, input.workspaceId);

    const [existing] = await transaction
      .select({
        id: schema.gen2SupersetRuns.id,
        sessionId: schema.gen2SupersetRuns.sessionId,
        status: schema.gen2SupersetRuns.status,
        createdBy: schema.gen2SupersetRuns.createdBy,
        chatId: schema.gen2SupersetRuns.chatId,
        worktreeId: schema.gen2SupersetRuns.worktreeId,
        provider: schema.gen2SupersetRuns.provider,
        connectionId: schema.gen2SupersetRuns.connectionId,
        credentialRevision: schema.gen2SupersetRuns.credentialRevision,
      })
      .from(schema.gen2SupersetRuns)
      .where(
        and(
          eq(schema.gen2SupersetRuns.workspaceId, input.workspaceId),
          eq(schema.gen2SupersetRuns.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.createdBy !== input.createdBy) {
        throw new Gen2LifecycleError("Superset run not found.", 404);
      }
      if (
        existing.chatId !== (input.chatId ?? null) ||
        existing.sessionId !== (input.sessionId ?? null) ||
        existing.worktreeId !== input.worktreeId ||
        existing.provider !== input.provider ||
        existing.connectionId !== (input.connectionId ?? null) ||
        existing.credentialRevision !== (input.credentialRevision ?? null)
      ) {
        throw new Gen2LifecycleError(
          "This agent request conflicts with an existing run.",
          409,
        );
      }
      return { runId: existing.id, status: existing.status, created: false };
    }

    const [run] = await transaction
      .insert(schema.gen2SupersetRuns)
      .values({
        sessionId: input.sessionId ?? null,
        workspaceId: input.workspaceId,
        chatId: input.chatId ?? null,
        createdBy: input.createdBy,
        worktreeId: input.worktreeId,
        provider:
          input.provider as (typeof schema.credentialProvider.enumValues)[number],
        connectionId: input.connectionId ?? null,
        credentialRevision: input.credentialRevision ?? null,
        idempotencyKey: input.idempotencyKey,
        status: "creating",
      })
      .returning({ id: schema.gen2SupersetRuns.id });

    await recordGen2SupersetRunAuditEvent(transaction, {
      runId: run!.id,
      workspaceId: input.workspaceId,
      actorId: input.createdBy,
      type: "run_created",
      result: "success",
    });

    return { runId: run!.id, status: "creating", created: true };
  });
}

export async function getGen2SupersetRunById(runId: string) {
  const [run] = await getDatabase()
    .select()
    .from(schema.gen2SupersetRuns)
    .where(eq(schema.gen2SupersetRuns.id, runId))
    .limit(1);
  return run ?? null;
}

/** All persisted sessions for the workspace, including completed runs. */
export async function listGen2SupersetRuns(workspaceId: string) {
  return getDatabase()
    .select()
    .from(schema.gen2SupersetRuns)
    .where(eq(schema.gen2SupersetRuns.workspaceId, workspaceId))
    .orderBy(sql`${schema.gen2SupersetRuns.createdAt} desc`);
}

/** Runs that need a liveness decision from the server-owned monitor. */
export async function listMonitorableGen2SupersetRuns() {
  return getDatabase()
    .select()
    .from(schema.gen2SupersetRuns)
    .where(inArray(schema.gen2SupersetRuns.status, MONITORABLE_STATUSES));
}

export async function listCheckpointableGen2SupersetRuns(workspaceId: string) {
  return getDatabase()
    .select()
    .from(schema.gen2SupersetRuns)
    .where(
      and(
        eq(schema.gen2SupersetRuns.workspaceId, workspaceId),
        inArray(schema.gen2SupersetRuns.status, MONITORABLE_STATUSES),
      ),
    );
}

/** Claim the run's hosted-subscription execution lease exactly once. */
export async function claimGen2SupersetRunLease(input: {
  runId: string;
  workspaceId: string;
  actorId?: string | null;
}) {
  return getDatabase().transaction(async (transaction) => {
    await lockSupersetRunWorkspace(transaction, input.workspaceId);
    await transaction
      .update(schema.gen2SupersetRuns)
      .set({ leaseClaimed: true, updatedAt: new Date() })
      .where(
        and(
          eq(schema.gen2SupersetRuns.id, input.runId),
          eq(schema.gen2SupersetRuns.workspaceId, input.workspaceId),
        ),
      );
    await recordGen2SupersetRunAuditEvent(transaction, {
      runId: input.runId,
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? null,
      type: "lease_claimed",
      result: "success",
    });
  });
}

/** Release the lease. Safe to call more than once for the same run. */
export async function releaseGen2SupersetRunLease(input: {
  runId: string;
  workspaceId: string;
  actorId?: string | null;
}) {
  return getDatabase().transaction(async (transaction) => {
    await lockSupersetRunWorkspace(transaction, input.workspaceId);
    const [run] = await transaction
      .select({ leaseClaimed: schema.gen2SupersetRuns.leaseClaimed })
      .from(schema.gen2SupersetRuns)
      .where(
        and(
          eq(schema.gen2SupersetRuns.id, input.runId),
          eq(schema.gen2SupersetRuns.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    if (!run || !run.leaseClaimed) {
      return;
    }
    await transaction
      .update(schema.gen2SupersetRuns)
      .set({ leaseClaimed: false, updatedAt: new Date() })
      .where(eq(schema.gen2SupersetRuns.id, input.runId));
    await recordGen2SupersetRunAuditEvent(transaction, {
      runId: input.runId,
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? null,
      type: "lease_released",
      result: "success",
    });
  });
}

/** Move a run from `creating` to `running` and record its host identifiers. */
export async function markGen2SupersetRunStarted(input: {
  runId: string;
  workspaceId: string;
  hostWorkspaceId: string;
  hostTerminalId: string;
  hostAgentSessionId: string;
  actorId?: string | null;
}) {
  return getDatabase().transaction(async (transaction) => {
    await lockSupersetRunWorkspace(transaction, input.workspaceId);
    const [run] = await transaction
      .update(schema.gen2SupersetRuns)
      .set({
        status: "running",
        hostWorkspaceId: input.hostWorkspaceId,
        hostTerminalId: input.hostTerminalId,
        hostAgentSessionId: input.hostAgentSessionId,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.gen2SupersetRuns.id, input.runId),
          eq(schema.gen2SupersetRuns.workspaceId, input.workspaceId),
        ),
      )
      .returning({ id: schema.gen2SupersetRuns.id });
    if (!run) {
      throw new Error("Superset run not found.");
    }
    await recordGen2SupersetRunAuditEvent(transaction, {
      runId: input.runId,
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? null,
      type: "run_started",
      result: "success",
    });
  });
}

async function transitionGen2SupersetRun(input: {
  runId: string;
  workspaceId: string;
  status: Gen2SupersetRunStatus;
  exitReason?: string | null;
  lastError?: string | null;
  auditType: Gen2SupersetRunAuditEventType;
  auditResult: "success" | "failure";
  actorId?: string | null;
}) {
  return getDatabase().transaction(async (transaction) => {
    await lockSupersetRunWorkspace(transaction, input.workspaceId);
    const [run] = await transaction
      .update(schema.gen2SupersetRuns)
      .set({
        status: input.status,
        exitReason: input.exitReason ?? undefined,
        lastError: input.lastError ?? undefined,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.gen2SupersetRuns.id, input.runId),
          eq(schema.gen2SupersetRuns.workspaceId, input.workspaceId),
        ),
      )
      .returning({ id: schema.gen2SupersetRuns.id });
    if (!run) {
      throw new Error("Superset run not found.");
    }
    await recordGen2SupersetRunAuditEvent(transaction, {
      runId: input.runId,
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? null,
      type: input.auditType,
      result: input.auditResult,
    });
  });
}

export async function markGen2SupersetRunStopping(input: {
  runId: string;
  workspaceId: string;
  actorId?: string | null;
}) {
  return transitionGen2SupersetRun({
    ...input,
    status: "stopping",
    auditType: "run_stopping",
    auditResult: "success",
  });
}

export async function markGen2SupersetRunFinished(input: {
  runId: string;
  workspaceId: string;
  exitReason?: string | null;
  actorId?: string | null;
}) {
  return transitionGen2SupersetRun({
    ...input,
    status: "finished",
    auditType: "run_finished",
    auditResult: "success",
  });
}

export async function markGen2SupersetRunFailed(input: {
  runId: string;
  workspaceId: string;
  lastError: string;
  actorId?: string | null;
}) {
  return transitionGen2SupersetRun({
    ...input,
    status: "failed",
    auditType: "run_failed",
    auditResult: "failure",
  });
}

/**
 * A host restart left this run's live state unverifiable. Do not relaunch it
 * automatically -- Phase 5 requires an explicit member-initiated resume with
 * a fresh connection and profile.
 */
export async function markGen2SupersetRunRecoveryRequired(input: {
  runId: string;
  workspaceId: string;
  lastError?: string | null;
  actorId?: string | null;
}) {
  return getDatabase().transaction(async (transaction) => {
    await lockSupersetRunWorkspace(transaction, input.workspaceId);
    const [run] = await transaction
      .update(schema.gen2SupersetRuns)
      .set({
        status: "recovery_required",
        lastError: input.lastError ?? undefined,
        recoveryCount: sql`${schema.gen2SupersetRuns.recoveryCount} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.gen2SupersetRuns.id, input.runId),
          eq(schema.gen2SupersetRuns.workspaceId, input.workspaceId),
        ),
      )
      .returning({ id: schema.gen2SupersetRuns.id });
    if (!run) {
      throw new Error("Superset run not found.");
    }
    await recordGen2SupersetRunAuditEvent(transaction, {
      runId: input.runId,
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? null,
      type: "recovery_required",
      result: "failure",
    });
  });
}

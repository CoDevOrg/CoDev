import "server-only";

import { and, eq, lt } from "drizzle-orm";

import { schema } from "@codev/db";

import {
  ClaudeConnectionError,
  persistClaudeOAuthToken,
  redactClaudeSecrets,
  resolveClaudeConnectionScope,
  validateClaudeOAuthToken,
  verifyClaudeInferenceAccess,
  type ClaudeInferenceVerifier,
} from "./claude-connection";
import { getDatabase } from "./database";
import { logEvent } from "./observability";

/** A "Connect Claude" attempt lives at most this long before it is abandoned. */
export const CLAUDE_CONNECTION_SESSION_TTL_MS = 10 * 60 * 1_000;

/**
 * The boundary the orchestration layer drives. Step 3 provides a real
 * implementation that runs the official `claude setup-token` binary in a
 * hosted runner; until then {@link unavailableClaudeRunner} is used and the
 * flow reports that hosted connect is not enabled.
 */
export interface ClaudeSetupTokenRunner {
  /**
   * Provision a runner and start `claude setup-token`. Resolves once the
   * runner has emitted the authorization URL the member must open.
   */
  start(input: { sessionId: string }): Promise<{
    runnerId: string;
    authorizeUrl: string;
  }>;
  /** Feed the authorization code the member pasted to the waiting process. */
  submitCode(input: { runnerId: string; code: string }): Promise<void>;
  /** Poll for the captured token (or a terminal failure). */
  poll(input: { runnerId: string }): Promise<ClaudeRunnerPollResult>;
  /** Best-effort teardown; never throws in a way the caller must handle. */
  dispose(input: { runnerId: string }): Promise<void>;
}

export type ClaudeRunnerPollResult =
  | { status: "pending" }
  | { status: "ready"; oauthToken: string }
  | { status: "failed"; reason: string };

/** Placeholder runner used until the hosted implementation lands (Step 3). */
export const unavailableClaudeRunner: ClaudeSetupTokenRunner = {
  async start() {
    throw new ClaudeConnectionError(
      "Hosted Claude connection is not available yet. Use an API key or the CoDev CLI for now.",
      503,
    );
  },
  async submitCode() {
    throw new ClaudeConnectionError(
      "Hosted Claude connection is not available yet.",
      503,
    );
  },
  async poll() {
    return {
      status: "failed",
      reason: "Hosted Claude connection is not available yet.",
    };
  },
  async dispose() {},
};

export type ClaudeConnectionSessionView = {
  id: string;
  status: (typeof schema.claudeConnectionSessionStatus.enumValues)[number];
  authorizeUrl: string | null;
  failureReason: string | null;
  scopeType: "USER" | "ORGANIZATION";
  scopeId: string;
};

type SessionRow = typeof schema.claudeConnectionSessions.$inferSelect;

/** A write we just issued must return its row; a miss means a lost race. */
function requireRow(rows: SessionRow[]): SessionRow {
  const [first] = rows;
  if (!first) {
    throw new ClaudeConnectionError("The connection session vanished.", 500);
  }
  return first;
}

function toView(row: SessionRow): ClaudeConnectionSessionView {
  return {
    id: row.id,
    status: row.status,
    authorizeUrl: row.authorizeUrl,
    failureReason: row.failureReason,
    scopeType: row.scopeType as "USER" | "ORGANIZATION",
    scopeId: row.scopeId,
  };
}

async function loadOwnedSession(userId: string, sessionId: string) {
  const [row] = await getDatabase()
    .select()
    .from(schema.claudeConnectionSessions)
    .where(
      and(
        eq(schema.claudeConnectionSessions.id, sessionId),
        eq(schema.claudeConnectionSessions.userId, userId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new ClaudeConnectionError("Connection session not found.", 404);
  }
  return row;
}

async function markFailed(sessionId: string, reason: string) {
  await getDatabase()
    .update(schema.claudeConnectionSessions)
    .set({
      status: "failed",
      failureReason: redactClaudeSecrets(reason),
      updatedAt: new Date(),
    })
    .where(eq(schema.claudeConnectionSessions.id, sessionId));
}

/**
 * Stop an in-progress connection owned by this member and release its runner.
 * Terminal sessions are intentionally idempotent so unload cleanup cannot
 * turn a connection that completed concurrently into an error.
 */
export async function cancelClaudeConnectionSession(
  input: { userId: string; sessionId: string },
  runner: ClaudeSetupTokenRunner = unavailableClaudeRunner,
): Promise<ClaudeConnectionSessionView> {
  const row = await loadOwnedSession(input.userId, input.sessionId);
  if (row.status === "connected" || row.status === "failed") {
    return toView(row);
  }
  if (row.runnerId) await runner.dispose({ runnerId: row.runnerId });
  const now = new Date();
  const updated = requireRow(
    await getDatabase()
      .update(schema.claudeConnectionSessions)
      .set({
        status: "failed",
        failureReason: "Connection attempt canceled.",
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.claudeConnectionSessions.id, row.id))
      .returning(),
  );
  return toView(updated);
}

/**
 * Release runners belonging to expired connection attempts and prune expired
 * terminal rows. This runs both before a member starts another attempt and
 * from lifecycle reconciliation, so abandoned browser tabs cannot pin
 * Firecracker capacity indefinitely.
 */
export async function reapExpiredClaudeConnectionSessions(
  runner: ClaudeSetupTokenRunner = unavailableClaudeRunner,
  input: { userId?: string; limit?: number } = {},
) {
  const conditions = [
    lt(schema.claudeConnectionSessions.expiresAt, new Date()),
  ];
  if (input.userId) {
    conditions.push(eq(schema.claudeConnectionSessions.userId, input.userId));
  }
  const expired = await getDatabase()
    .select({
      id: schema.claudeConnectionSessions.id,
      runnerId: schema.claudeConnectionSessions.runnerId,
    })
    .from(schema.claudeConnectionSessions)
    .where(and(...conditions))
    .limit(input.limit ?? 100);

  let cleaned = 0;
  let failures = 0;
  for (const session of expired) {
    try {
      if (session.runnerId) {
        await runner.dispose({ runnerId: session.runnerId });
      }
      await getDatabase()
        .delete(schema.claudeConnectionSessions)
        .where(eq(schema.claudeConnectionSessions.id, session.id));
      cleaned += 1;
    } catch (error) {
      failures += 1;
      logEvent("warn", "claude_connection.expired_cleanup_failed", {
        sessionId: session.id,
        detail: redactClaudeSecrets(
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
  }
  return { cleaned, failures };
}

/**
 * Begin a hosted "Connect Claude" flow for a signed-in member. Resolves once
 * there is an authorization URL to show, or throws if the runner could not
 * start.
 */
export async function startClaudeConnectionSession(
  input: { userId: string; scopeType?: unknown; organizationId?: unknown },
  runner: ClaudeSetupTokenRunner = unavailableClaudeRunner,
): Promise<ClaudeConnectionSessionView> {
  const { scopeType, scopeId } = await resolveClaudeConnectionScope(input);

  // Sweep this member's stale runners before allocating another scarce
  // sandbox. Best-effort: cleanup failure must not block a fresh attempt.
  try {
    await reapExpiredClaudeConnectionSessions(runner, {
      userId: input.userId,
    });
  } catch (error) {
    logEvent("warn", "claude_connection.stale_sweep_failed", {
      detail: redactClaudeSecrets(
        error instanceof Error ? error.message : String(error),
      ),
    });
  }

  const row = requireRow(
    await getDatabase()
      .insert(schema.claudeConnectionSessions)
      .values({
        userId: input.userId,
        scopeType,
        scopeId,
        status: "starting",
        expiresAt: new Date(Date.now() + CLAUDE_CONNECTION_SESSION_TTL_MS),
      })
      .returning(),
  );

  try {
    const { runnerId, authorizeUrl } = await runner.start({
      sessionId: row.id,
    });
    const updated = requireRow(
      await getDatabase()
        .update(schema.claudeConnectionSessions)
        .set({
          status: "awaiting_code",
          runnerId,
          authorizeUrl,
          updatedAt: new Date(),
        })
        .where(eq(schema.claudeConnectionSessions.id, row.id))
        .returning(),
    );
    return toView(updated);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "The runner failed to start.";
    await markFailed(row.id, reason);
    throw error instanceof ClaudeConnectionError
      ? error
      : new ClaudeConnectionError(reason, 502);
  }
}

/**
 * Hand the authorization code the member copied from Anthropic to the waiting
 * runner process.
 */
export async function submitClaudeConnectionCode(
  input: { userId: string; sessionId: string; code: string },
  runner: ClaudeSetupTokenRunner = unavailableClaudeRunner,
): Promise<ClaudeConnectionSessionView> {
  const code = input.code.trim();
  if (!code) throw new ClaudeConnectionError("Authorization code is required.");

  const row = await loadOwnedSession(input.userId, input.sessionId);
  if (row.status !== "awaiting_code" || !row.runnerId) {
    throw new ClaudeConnectionError(
      `This connection session is ${row.status}; start a new one.`,
      409,
    );
  }
  if (row.expiresAt.getTime() < Date.now()) {
    await markFailed(row.id, "The connection attempt timed out.");
    throw new ClaudeConnectionError("The connection attempt timed out.", 410);
  }

  await runner.submitCode({ runnerId: row.runnerId, code });
  const updated = requireRow(
    await getDatabase()
      .update(schema.claudeConnectionSessions)
      .set({ status: "exchanging", updatedAt: new Date() })
      .where(eq(schema.claudeConnectionSessions.id, row.id))
      .returning(),
  );
  return toView(updated);
}

/**
 * Report where a connection session stands. While the runner is still
 * working this polls it; on success the captured token is persisted to
 * `provider_credentials` and the runner is torn down.
 */
export async function getClaudeConnectionSession(
  input: { userId: string; sessionId: string },
  runner: ClaudeSetupTokenRunner = unavailableClaudeRunner,
  verify: ClaudeInferenceVerifier = verifyClaudeInferenceAccess,
): Promise<ClaudeConnectionSessionView> {
  const row = await loadOwnedSession(input.userId, input.sessionId);

  const terminal = row.status === "connected" || row.status === "failed";
  if (terminal) return toView(row);

  if (row.expiresAt.getTime() < Date.now()) {
    if (row.runnerId) await runner.dispose({ runnerId: row.runnerId });
    await markFailed(row.id, "The connection attempt timed out.");
    return toView(await loadOwnedSession(input.userId, input.sessionId));
  }

  if (!row.runnerId) return toView(row);

  const result = await runner.poll({ runnerId: row.runnerId });
  if (result.status === "pending") return toView(row);

  if (result.status === "failed") {
    await runner.dispose({ runnerId: row.runnerId });
    await markFailed(row.id, result.reason);
    return toView(await loadOwnedSession(input.userId, input.sessionId));
  }

  // result.status === "ready"
  try {
    const oauthToken = validateClaudeOAuthToken(result.oauthToken);
    await verify(oauthToken);
    await persistClaudeOAuthToken({
      scopeType: row.scopeType as "USER" | "ORGANIZATION",
      scopeId: row.scopeId,
      oauthToken,
      source: "hosted_runner",
    });
    await getDatabase()
      .update(schema.claudeConnectionSessions)
      .set({
        status: "connected",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.claudeConnectionSessions.id, row.id));
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "The captured token could not be saved.";
    await markFailed(row.id, reason);
  } finally {
    await runner.dispose({ runnerId: row.runnerId });
  }
  return toView(await loadOwnedSession(input.userId, input.sessionId));
}

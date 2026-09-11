import "server-only";

import { and, desc, eq, inArray, lt, ne } from "drizzle-orm";

import { schema } from "@codev/db";

import {
  ClaudeConnectionError,
  redactClaudeSecrets,
  resolveClaudeConnectionScope,
} from "./claude-connection";
import { getDatabase } from "./database";
import { deleteProviderCredential } from "./credentials";
import { logEvent } from "./observability";
import { isClaudeRuntimeReference } from "./claude-runtime-reference";

/** A "Connect Claude" attempt lives at most this long before it is abandoned. */
export const CLAUDE_CONNECTION_SESSION_TTL_MS = 10 * 60 * 1_000;

/**
 * Official CLI login transport. Credentials remain in the runtime profile.
 */
export interface ClaudeLoginRunner {
  /**
   * Provision a runner and start `claude auth login`. Resolves once the
   * runner has emitted the authorization URL the member must open.
   */
  start(input: { sessionId: string }): Promise<{
    runnerId: string;
    authorizeUrl: string;
  }>;
  /** Feed the authorization code the member pasted to the waiting process. */
  submitCode(input: { runnerId: string; code: string }): Promise<void>;
  /** Poll verified CLI auth status (or a terminal failure), never credentials. */
  poll(input: { runnerId: string }): Promise<ClaudeRunnerPollResult>;
  /** Delete the private profile; failures must remain retryable. */
  dispose(input: { runnerId: string }): Promise<void>;
  /** Persist runtime-owned login state before acknowledging the connection. */
  retain?(input: { runnerId: string }): Promise<void>;
}

export type ClaudeRunnerPollResult =
  | { status: "pending" }
  | { status: "ready" }
  | { status: "failed"; reason: string };

/** Placeholder runner used until the hosted implementation lands (Step 3). */
export const unavailableClaudeRunner: ClaudeLoginRunner = {
  async start() {
    throw new ClaudeConnectionError(
      "Official Claude login is not configured. Contact your CoDev administrator.",
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
      authorizeUrl: null,
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
  suppliedRunner?: ClaudeLoginRunner,
): Promise<ClaudeConnectionSessionView> {
  const row = await loadOwnedSession(input.userId, input.sessionId);
  if (row.status === "connected" || row.status === "failed") {
    return toView(row);
  }
  const runner = await sessionRunner(row.runnerId, suppliedRunner);
  const now = new Date();
  const [updated] = await getDatabase()
    .update(schema.claudeConnectionSessions)
    .set({
      status: "failed",
      authorizeUrl: null,
      failureReason: "Connection attempt canceled.",
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.claudeConnectionSessions.id, row.id),
        ne(schema.claudeConnectionSessions.status, "connected"),
      ),
    )
    .returning();
  if (!updated)
    return toView(await loadOwnedSession(input.userId, input.sessionId));
  if (row.runnerId) await runner.dispose({ runnerId: row.runnerId });
  return toView(updated);
}

/**
 * Release runners belonging to expired connection attempts and prune expired
 * terminal rows. This runs both before a member starts another attempt and
 * from lifecycle reconciliation, so abandoned browser tabs cannot pin
 * Firecracker capacity indefinitely.
 */
export async function reapExpiredClaudeConnectionSessions(
  suppliedRunner?: ClaudeLoginRunner,
  input: { userId?: string; limit?: number } = {},
) {
  const conditions = [
    lt(schema.claudeConnectionSessions.expiresAt, new Date()),
    ne(schema.claudeConnectionSessions.status, "connected"),
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
      const [claimed] = await getDatabase()
        .update(schema.claudeConnectionSessions)
        .set({
          status: "failed",
          authorizeUrl: null,
          failureReason: "Connection attempt expired.",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.claudeConnectionSessions.id, session.id),
            ne(schema.claudeConnectionSessions.status, "connected"),
          ),
        )
        .returning();
      if (!claimed) continue;
      if (session.runnerId) {
        if (suppliedRunner || isClaudeRuntimeReference(session.runnerId)) {
          const runner = await sessionRunner(session.runnerId, suppliedRunner);
          await runner.dispose({ runnerId: session.runnerId });
        }
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
  runner: ClaudeLoginRunner = unavailableClaudeRunner,
): Promise<ClaudeConnectionSessionView> {
  if (input.scopeType === "ORGANIZATION") {
    throw new ClaudeConnectionError(
      "Claude subscriptions must be connected personally, not shared with an organization.",
      400,
    );
  }
  const { scopeType, scopeId } = await resolveClaudeConnectionScope(input);

  // Sweep this member's stale runners before allocating another scarce
  // sandbox. Best-effort: cleanup failure must not block a fresh attempt.
  try {
    await reapExpiredClaudeConnectionSessions(undefined, {
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

  let allocatedRunnerId: string | undefined;
  try {
    const { runnerId, authorizeUrl } = await runner.start({
      sessionId: row.id,
    });
    allocatedRunnerId = runnerId;
    const updated = requireRow(
      await getDatabase()
        .update(schema.claudeConnectionSessions)
        .set({
          status: "awaiting_code",
          runnerId,
          authorizeUrl,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.claudeConnectionSessions.id, row.id),
            eq(schema.claudeConnectionSessions.status, "starting"),
          ),
        )
        .returning(),
    );
    return toView(updated);
  } catch (error) {
    if (allocatedRunnerId)
      await runner.dispose({ runnerId: allocatedRunnerId });
    const reason =
      error instanceof ClaudeConnectionError
        ? error.message
        : "Unable to start official Claude login. Check the runtime configuration and try again.";
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
  suppliedRunner?: ClaudeLoginRunner,
): Promise<ClaudeConnectionSessionView> {
  const code = input.code.trim();
  if (!code) throw new ClaudeConnectionError("Authorization code is required.");
  if (code.length > 4096 || /[\r\n]/.test(code))
    throw new ClaudeConnectionError("Invalid authorization code.");

  const row = await loadOwnedSession(input.userId, input.sessionId);
  const runner = await sessionRunner(row.runnerId, suppliedRunner);
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
      .where(
        and(
          eq(schema.claudeConnectionSessions.id, row.id),
          eq(schema.claudeConnectionSessions.status, "awaiting_code"),
        ),
      )
      .returning(),
  );
  return toView(updated);
}

/**
 * Report where a connection session stands. While the runner is still
 * working this polls it; on success the runtime is retained and CoDev stores
 * only its opaque reference in the existing session record.
 */
export async function getClaudeConnectionSession(
  input: { userId: string; sessionId: string },
  suppliedRunner?: ClaudeLoginRunner,
): Promise<ClaudeConnectionSessionView> {
  const row = await loadOwnedSession(input.userId, input.sessionId);
  if (
    !suppliedRunner &&
    row.status === "connected" &&
    !isClaudeRuntimeReference(row.runnerId)
  ) {
    throw new ClaudeConnectionError(
      "This legacy connection requires reconnecting with official Claude login.",
      410,
    );
  }
  const terminal = row.status === "connected" || row.status === "failed";
  if (terminal) return toView(row);
  const runner = await sessionRunner(row.runnerId, suppliedRunner);

  if (row.expiresAt.getTime() < Date.now()) {
    if (row.runnerId) await runner.dispose({ runnerId: row.runnerId });
    await markFailed(row.id, "The connection attempt timed out.");
    return toView(await loadOwnedSession(input.userId, input.sessionId));
  }

  if (!row.runnerId) return toView(row);
  // A poll winner is currently retaining the profile. Other polls wait.
  if (row.status === "starting") return toView(row);

  const result = await runner.poll({ runnerId: row.runnerId });
  if (result.status === "pending") return toView(row);

  if (result.status === "failed") {
    await runner.dispose({ runnerId: row.runnerId });
    await markFailed(row.id, result.reason);
    return toView(await loadOwnedSession(input.userId, input.sessionId));
  }

  // result.status === "ready"
  const [claimed] = await getDatabase()
    .update(schema.claudeConnectionSessions)
    .set({ status: "starting", updatedAt: new Date() })
    .where(
      and(
        eq(schema.claudeConnectionSessions.id, row.id),
        inArray(schema.claudeConnectionSessions.status, [
          "awaiting_code",
          "exchanging",
        ]),
      ),
    )
    .returning();
  if (!claimed)
    return toView(await loadOwnedSession(input.userId, input.sessionId));
  try {
    await runner.retain?.({ runnerId: row.runnerId });
    // Reconnection retires any previously stored subscription token, not API keys.
    await deleteProviderCredential(
      "USER",
      row.userId,
      "anthropic",
      "OAUTH_TOKEN",
    );
    const saved = await getDatabase()
      .update(schema.claudeConnectionSessions)
      .set({
        status: "connected",
        authorizeUrl: null,
        // Connected rows use expiry as the subscription execution lease.
        expiresAt: new Date(0),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.claudeConnectionSessions.id, row.id),
          ne(schema.claudeConnectionSessions.status, "failed"),
        ),
      )
      .returning();
    if (!saved.length) await runner.dispose({ runnerId: row.runnerId });
  } catch {
    await markFailed(
      row.id,
      "The signed-in runtime could not be retained. Try connecting again.",
    );
    await runner.dispose({ runnerId: row.runnerId });
  }
  return toView(await loadOwnedSession(input.userId, input.sessionId));
}

async function sessionRunner(
  reference: string | null,
  supplied?: ClaudeLoginRunner,
) {
  if (supplied) return supplied;
  if (!reference) return unavailableClaudeRunner;
  if (!isClaudeRuntimeReference(reference))
    throw new ClaudeConnectionError(
      "This legacy connection requires reconnecting with official Claude login.",
      410,
    );
  const { resolveClaudeRunner } = await import("./claude-connection-runner");
  return resolveClaudeRunner(reference);
}

/** Server-only reference lookup. Never read or return the runtime's credential files. */
export async function getConnectedClaudeRuntime(userId: string) {
  const rows = await getDatabase()
    .select()
    .from(schema.claudeConnectionSessions)
    .where(
      and(
        eq(schema.claudeConnectionSessions.userId, userId),
        eq(schema.claudeConnectionSessions.scopeType, "USER"),
        eq(schema.claudeConnectionSessions.status, "connected"),
      ),
    )
    .orderBy(desc(schema.claudeConnectionSessions.createdAt));
  return rows.find((row) => isClaudeRuntimeReference(row.runnerId)) ?? null;
}

export async function disconnectClaudeRuntime(userId: string) {
  const rows = await getDatabase()
    .select()
    .from(schema.claudeConnectionSessions)
    .where(
      and(
        eq(schema.claudeConnectionSessions.userId, userId),
        eq(schema.claudeConnectionSessions.status, "connected"),
      ),
    );
  for (const row of rows) {
    if (!isClaudeRuntimeReference(row.runnerId)) continue;
    const runner = await sessionRunner(row.runnerId);
    // Leave the record connected if runtime cleanup fails, so it can be retried.
    await runner.dispose({ runnerId: row.runnerId });
    await markFailed(row.id, "Disconnected.");
  }
}

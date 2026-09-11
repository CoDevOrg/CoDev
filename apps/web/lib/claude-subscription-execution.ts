import "server-only";

import { and, eq, lt } from "drizzle-orm";

import { schema } from "@codev/db";

import { ClaudeConnectionError } from "./claude-connection";
import { getDatabase } from "./database";

/**
 * A Claude Pro/Max subscription is a human seat, not a shared backend pool:
 * A connected profile runs at most one CLI invocation at a time. Reuse the
 * row-level compare-and-set lease pattern on the connection's expiresAt;
 * connected rows are excluded from login-attempt expiry. The lease deadline
 * fences cleanup, so an old finalizer cannot unlock a newer invocation.
 */
const LEASE_MS = 10 * 60 * 1_000;

/**
 * Take the execution lease on the requesting member's connected runtime.
 * Throws {@link ClaudeConnectionError} (429) if another turn already holds it
 * or the connection is no longer active or belongs to another member.
 */
export async function claimClaudeSubscriptionExecution(
  credentialId: string,
  userId: string,
) {
  const until = new Date(Date.now() + LEASE_MS);
  const [claimed] = await getDatabase()
    .update(schema.claudeConnectionSessions)
    .set({
      expiresAt: until,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.claudeConnectionSessions.id, credentialId),
        eq(schema.claudeConnectionSessions.userId, userId),
        eq(schema.claudeConnectionSessions.scopeType, "USER"),
        eq(schema.claudeConnectionSessions.status, "connected"),
        lt(schema.claudeConnectionSessions.expiresAt, new Date()),
      ),
    )
    .returning({ id: schema.claudeConnectionSessions.id });
  if (!claimed) {
    throw new ClaudeConnectionError(
      "Your Claude subscription is already running another cloud turn. Try again shortly.",
      429,
    );
  }
  return until.getTime();
}

/** Release the execution lease. Safe to call more than once. */
export async function releaseClaudeSubscriptionExecution(
  credentialId: string,
  leaseUntil: number,
) {
  await getDatabase()
    .update(schema.claudeConnectionSessions)
    .set({ expiresAt: new Date(0), updatedAt: new Date() })
    .where(
      and(
        eq(schema.claudeConnectionSessions.id, credentialId),
        eq(schema.claudeConnectionSessions.expiresAt, new Date(leaseUntil)),
      ),
    );
}

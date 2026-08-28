import "server-only";

import { sql } from "drizzle-orm";

import { getDatabase } from "./database";

type AgentSessionTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0];

/**
 * Serializes queue and claim transitions for one durable agent session.
 * Kicks can still race safely through their status CAS, but enqueue/idle and
 * claim/running decisions must observe one ordered stream.
 */
export async function lockAgentSession(
  transaction: AgentSessionTransaction,
  sessionId: string,
) {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`agent-session:${sessionId}`}, 0))`,
  );
}

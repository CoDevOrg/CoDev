import "server-only";

import { env } from "cloudflare:workers";
import { createDatabase } from "@codev/db";
import { getDatabase } from "../platform/database";
import { sessionRevision } from "./session-revision";
import { readSessionState } from "./user-sessions";

async function read(
  database: ReturnType<typeof getDatabase>,
  userId: string,
  sessionId: string | undefined,
) {
  const state = await readSessionState(userId, sessionId, database);
  // A revoked session reads like a deleted account: the socket closes.
  return state?.usable ? sessionRevision(state.passwordHash) : null;
}

/** Socket callbacks outlive the Hyperdrive pool closed after the HTTP handshake. */
export async function readSessionRevision(userId: string, sessionId?: string) {
  const binding = (env as { HYPERDRIVE?: { connectionString?: string } })
    .HYPERDRIVE;
  if (!binding?.connectionString) return read(getDatabase(), userId, sessionId);
  const url = new URL(binding.connectionString);
  url.searchParams.set("sslmode", "disable");
  const database = createDatabase(url.toString(), { max: 1, maxUses: 1 });
  try {
    return await read(database.db, userId, sessionId);
  } finally {
    await database.pool.end();
  }
}

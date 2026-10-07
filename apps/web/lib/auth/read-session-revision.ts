import "server-only";

import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@codev/db";
import { getDatabase } from "../platform/database";
import { sessionRevision } from "./session-revision";

async function read(database: ReturnType<typeof getDatabase>, userId: string) {
  const [row] = await database
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return row ? sessionRevision(row.passwordHash) : null;
}

/** Socket callbacks outlive the Hyperdrive pool closed after the HTTP handshake. */
export async function readSessionRevision(userId: string) {
  const binding = (env as { HYPERDRIVE?: { connectionString?: string } })
    .HYPERDRIVE;
  if (!binding?.connectionString) return read(getDatabase(), userId);
  const url = new URL(binding.connectionString);
  url.searchParams.set("sslmode", "disable");
  const database = createDatabase(url.toString(), { max: 1, maxUses: 1 });
  try {
    return await read(database.db, userId);
  } finally {
    await database.pool.end();
  }
}

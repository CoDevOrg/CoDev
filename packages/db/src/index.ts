import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { normalizePostgresConnectionString } from "./connection";
import * as schema from "./schema";

export function createDatabase(
  connectionString: string,
  options?: { max?: number; maxUses?: number; idleTimeoutMillis?: number },
) {
  const pool = new Pool({
    connectionString: normalizePostgresConnectionString(connectionString),
    max: options?.max ?? 5,
    maxUses: options?.maxUses,
    idleTimeoutMillis: options?.idleTimeoutMillis ?? 10_000,
    // Keeps idle sockets from being silently dropped by cloud NAT while the
    // pool still considers them usable.
    keepAlive: true,
    connectionTimeoutMillis: 5_000,
  });
  // An idle client failure is emitted as an event. Without a listener Node
  // treats it as uncaught and the Worker dies with error 1101.
  pool.on("error", () => undefined);

  return {
    db: drizzle(pool, { schema }),
    pool,
  };
}

export { schema };
export type {
  AgentBriefPlanStep,
  AgentTurnAttachment,
  WorkspaceChatPromptAttachment,
} from "./schema";
export { normalizePostgresConnectionString } from "./connection";

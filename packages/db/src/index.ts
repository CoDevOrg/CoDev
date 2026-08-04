import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { normalizePostgresConnectionString } from "./connection";
import * as schema from "./schema";

export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString: normalizePostgresConnectionString(connectionString),
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
  };
}

export { schema };
export type { AgentTurnAttachment } from "./schema";
export { normalizePostgresConnectionString } from "./connection";

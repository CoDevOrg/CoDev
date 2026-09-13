import "server-only";

import { readServerEnvironment } from "@codev/config";
import { createDatabase } from "@codev/db";
import { attachDatabasePool } from "@vercel/functions";

type DatabaseClient = ReturnType<typeof createDatabase>;

// Next.js development compiles route handlers into separate module graphs. A
// module-local singleton therefore creates one five-connection pool per route,
// which quickly starves a remote Postgres pooler when the workspace's live
// panels refresh together. globalThis is shared by those graphs in the same
// server process, while each production function instance still gets its own
// appropriately scoped pool.
const databaseState = globalThis as typeof globalThis & {
  __codevDatabaseClient?: DatabaseClient;
};

function getDatabaseClient() {
  if (!databaseState.__codevDatabaseClient) {
    const environment = readServerEnvironment();
    const connectionString =
      environment.POSTGRES_URL ?? environment.DATABASE_URL;

    if (!connectionString) {
      throw new Error("A PostgreSQL connection URL is not configured.");
    }

    const database = createDatabase(connectionString);
    attachDatabasePool(database.pool);
    databaseState.__codevDatabaseClient = database;
  }

  return databaseState.__codevDatabaseClient!;
}

export function getDatabase() {
  return getDatabaseClient().db;
}

export async function checkDatabaseConnection() {
  await getDatabaseClient().pool.query("select 1");
}

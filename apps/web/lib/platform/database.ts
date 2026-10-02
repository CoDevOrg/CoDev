import "server-only";

import { readServerEnvironment } from "@codev/config";
import { createDatabase } from "@codev/db";
import { attachDatabasePool } from "@vercel/functions";
import { env } from "cloudflare:workers";

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

function hyperdriveConnectionString() {
  const binding = (env as { HYPERDRIVE?: { connectionString?: string } })
    .HYPERDRIVE;
  const connectionString = binding?.connectionString;
  if (!connectionString) return undefined;
  // Hyperdrive terminates TLS to Postgres. The string it gives the Worker is
  // a local socket, and asking node-postgres to negotiate SSL against it
  // drops the connection.
  const url = new URL(connectionString);
  url.searchParams.set("sslmode", "disable");
  return url.toString();
}

function getDatabaseClient() {
  const hyperdrive = hyperdriveConnectionString();
  const existing = databaseState.__codevDatabaseClient;
  // A Worker isolate stays warm, but Hyperdrive sockets do not. Reusing an
  // idle client makes the next request wait on I/O that will never finish,
  // and the runtime cancels it as error 1101.
  if (existing && !(hyperdrive && existing.pool.idleCount > 0)) {
    return existing;
  }
  delete databaseState.__codevDatabaseClient;

  const environment = readServerEnvironment();
  const connectionString =
    hyperdrive ?? environment.POSTGRES_URL ?? environment.DATABASE_URL;

  if (!connectionString) {
    throw new Error("A PostgreSQL connection URL is not configured.");
  }

  const database = createDatabase(
    connectionString,
    hyperdrive ? { maxUses: 1 } : undefined,
  );
  database.pool.on("error", () => {
    if (databaseState.__codevDatabaseClient === database) {
      delete databaseState.__codevDatabaseClient;
    }
  });
  if (!hyperdrive) attachDatabasePool(database.pool);
  databaseState.__codevDatabaseClient = database;

  return database;
}

export function getDatabase() {
  return getDatabaseClient().db;
}

export async function checkDatabaseConnection() {
  await getDatabaseClient().pool.query("select 1");
}

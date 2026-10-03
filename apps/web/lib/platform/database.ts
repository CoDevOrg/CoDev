import "server-only";

import { cache } from "react";
import { after } from "next/server";
import { readServerEnvironment } from "@codev/config";
import { createDatabase } from "@codev/db";
import { attachDatabasePool } from "@vercel/functions";
import { env } from "cloudflare:workers";

type DatabaseClient = ReturnType<typeof createDatabase>;

// Settings reads several credentials at once. A pool of 5 makes the extras
// wait, and a slow connection then fails the whole page.
const HYPERDRIVE_POOL_MAX = 10;

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

// One pool per request. A Worker isolate stays warm, but a Hyperdrive socket
// from the previous request is already dead: the next page waits on it and
// then fails with the generic "This page couldn't load" screen.
const getHyperdriveDatabase = cache(() => {
  const connectionString = hyperdriveConnectionString();
  if (!connectionString) {
    throw new Error("A PostgreSQL connection URL is not configured.");
  }
  const database = createDatabase(connectionString, {
    max: HYPERDRIVE_POOL_MAX,
    maxUses: 1,
  });
  after(() => database.pool.end().catch(() => undefined));
  return database;
});

function getDatabaseClient() {
  if (hyperdriveConnectionString()) return getHyperdriveDatabase();

  const existing = databaseState.__codevDatabaseClient;
  if (existing) return existing;

  const environment = readServerEnvironment();
  const connectionString = environment.POSTGRES_URL ?? environment.DATABASE_URL;

  if (!connectionString) {
    throw new Error("A PostgreSQL connection URL is not configured.");
  }

  const database = createDatabase(connectionString);
  database.pool.on("error", () => {
    if (databaseState.__codevDatabaseClient === database) {
      delete databaseState.__codevDatabaseClient;
    }
  });
  attachDatabasePool(database.pool);
  databaseState.__codevDatabaseClient = database;

  return database;
}

export function getDatabase() {
  return getDatabaseClient().db;
}

export async function checkDatabaseConnection() {
  await getDatabaseClient().pool.query("select 1");
}

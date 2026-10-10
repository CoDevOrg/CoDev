import "server-only";

import { cache } from "react";
import { after } from "next/server";
import { readServerEnvironment } from "@codev/config";
import { createDatabase } from "@codev/db";
import { attachDatabasePool } from "@vercel/functions";
import {
  databaseOperationContext,
  hyperdriveConnectionString,
} from "./database-operation";

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
  });
  after(() => database.pool.end().catch(() => undefined));
  return database;
});

function getDatabaseClient() {
  const operation = databaseOperationContext.getStore();
  if (operation) return operation;
  if (hyperdriveConnectionString()) return getHyperdriveDatabase();

  const existing = databaseState.__codevDatabaseClient;
  if (existing) return existing;

  const environment = readServerEnvironment();
  const connectionString = environment.POSTGRES_URL ?? environment.DATABASE_URL;

  if (!connectionString) {
    throw new Error("A PostgreSQL connection URL is not configured.");
  }

  // A warm process (the Azure origin) reuses connections across requests.
  // Opening one to the database in another region costs several round trips
  // (~70 ms each), which a 10 s idle timeout paid on most settings clicks.
  const database = createDatabase(connectionString, {
    idleTimeoutMillis: 60_000,
  });
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

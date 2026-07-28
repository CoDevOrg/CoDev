import "server-only";

import { readServerEnvironment } from "@codev/config";
import { createDatabase } from "@codev/db";
import { attachDatabasePool } from "@vercel/functions";

let database: ReturnType<typeof createDatabase> | undefined;

function getDatabaseClient() {
  if (!database) {
    const environment = readServerEnvironment();
    const connectionString =
      environment.POSTGRES_URL ?? environment.DATABASE_URL;

    if (!connectionString) {
      throw new Error("A PostgreSQL connection URL is not configured.");
    }

    database = createDatabase(connectionString);
    attachDatabasePool(database.pool);
  }

  return database;
}

export function getDatabase() {
  return getDatabaseClient().db;
}

export async function checkDatabaseConnection() {
  await getDatabaseClient().pool.query("select 1");
}

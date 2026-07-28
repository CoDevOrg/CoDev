import "server-only";

import { createDatabase } from "@codev/db";
import { attachDatabasePool } from "@vercel/functions";

let database: ReturnType<typeof createDatabase> | undefined;

export function getDatabase(connectionString: string) {
  if (!database) {
    database = createDatabase(connectionString);
    attachDatabasePool(database.pool);
  }

  return database.db;
}

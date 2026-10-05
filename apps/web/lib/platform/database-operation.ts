import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createDatabase } from "@codev/db";
import { env } from "cloudflare:workers";

type DatabaseClient = ReturnType<typeof createDatabase>;
export const databaseOperationContext = new AsyncLocalStorage<DatabaseClient>();

export function hyperdriveConnectionString() {
  const connectionString = (
    env as { HYPERDRIVE?: { connectionString?: string } }
  ).HYPERDRIVE?.connectionString;
  if (!connectionString) return undefined;
  const url = new URL(connectionString);
  url.searchParams.set("sslmode", "disable");
  return url.toString();
}

// Reuse connections within this operation; closing the pool prevents cross-request sockets.
/** Bound the pool to an async operation, including socket messages and guest polls. */
export async function withDatabaseOperation<T>(action: () => Promise<T>) {
  const connectionString = hyperdriveConnectionString();
  if (!connectionString) return action();
  const database = createDatabase(connectionString, { max: 10 });
  return databaseOperationContext.run(database, async () => {
    try {
      return await action();
    } finally {
      await database.pool.end();
    }
  });
}

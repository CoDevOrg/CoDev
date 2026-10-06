import "server-only";
import { createDatabase } from "@codev/db";

export async function withArmWorkflowDatabase<T>(
  env: { HYPERDRIVE?: { connectionString?: string } },
  action: (db: ReturnType<typeof createDatabase>["db"]) => Promise<T>,
) {
  const connectionString = env.HYPERDRIVE?.connectionString;
  if (!connectionString) throw new Error("HYPERDRIVE_NOT_CONFIGURED");
  const url = new URL(connectionString);
  url.searchParams.set("sslmode", "disable");
  const database = createDatabase(url.toString(), { max: 1, maxUses: 1 });
  try {
    return await action(database.db);
  } finally {
    await database.pool.end();
  }
}

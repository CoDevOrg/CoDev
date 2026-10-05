import "server-only";
import { asc, inArray } from "drizzle-orm";
import { schema } from "@codev/db";
import { getDatabase } from "../platform/database";

export type ComputeDatabase = Pick<
  ReturnType<typeof getDatabase>,
  "select" | "insert" | "update" | "delete" | "execute"
>;
export type ComputeTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0];

/** Same owner lock for create, delete, transfer, and free startup reservations. */
export async function lockComputeOwners(
  db: ComputeDatabase,
  ownerIds: string[],
) {
  await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.id, [...new Set(ownerIds)]))
    .orderBy(asc(schema.users.id))
    .for("update");
}

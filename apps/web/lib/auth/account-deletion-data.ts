import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@codev/db";
import { detachSharedAttribution } from "./account-deletion-attribution";
import type { getDatabase } from "../platform/database";

type Transaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0];

export async function eraseAccountData(
  db: Transaction,
  userId: string,
  email: string,
) {
  await detachSharedAttribution(db, userId);
  await db
    .delete(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.scopeId, userId),
        eq(schema.providerCredentials.scopeType, "USER"),
      ),
    );
  await db.delete(schema.pageViews).where(eq(schema.pageViews.userId, userId));
  await db
    .delete(schema.accessRequests)
    .where(sql`lower(${schema.accessRequests.email}) = ${email.toLowerCase()}`);
  // Keep only the billing boundary needed by invoices/disputes, without profile names.
  await db
    .update(schema.organizations)
    .set({
      name: "Deleted account",
      slug: `deleted-${randomUUID()}`,
      updatedAt: new Date(),
    })
    .where(eq(schema.organizations.id, userId));
  await db
    .update(schema.organizationSubscriptions)
    .set({
      status: "canceled",
      planId: "free",
      cancelAtPeriodEnd: false,
      canceledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.organizationSubscriptions.organizationId, userId));
  // FK cascades remove memberships, private conversations, GitHub tokens,
  // environment secrets, CLI/device/push tokens, connection sessions and usage.
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}

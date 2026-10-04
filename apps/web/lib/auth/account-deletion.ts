import "server-only";

import { eq } from "drizzle-orm";
import { schema } from "@codev/db";
import { ApiError } from "../http/api-route";
import { getDatabase } from "../platform/database";
import { deleteBillingCustomer } from "../billing/delete-customer";
import { assertAccountCanBeDeleted } from "./account-deletion-checks";
import { eraseAccountData } from "./account-deletion-data";
import { verifyAccountDeletionToken } from "./account-deletion-token";

export async function deleteAccount(userId: string, token: string) {
  await getDatabase().transaction(async (db) => {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .for("update");
    if (
      !user?.email ||
      !verifyAccountDeletionToken(token, userId, user.email)
    ) {
      throw new ApiError(
        "Verification code is invalid or expired. Request a new email.",
        403,
      );
    }
    await assertAccountCanBeDeleted(db, userId);
    const [billing] = await db
      .select()
      .from(schema.organizationSubscriptions)
      .where(eq(schema.organizationSubscriptions.organizationId, userId))
      .for("update");
    if (billing?.provider === "stripe" && billing.providerCustomerId) {
      await deleteBillingCustomer(billing.providerCustomerId);
    }
    await eraseAccountData(db, userId, user.email);
  });
}

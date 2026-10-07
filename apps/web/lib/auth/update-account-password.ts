import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@codev/db";
import { getDatabase } from "../platform/database";
import { hashPassword } from "../platform/crypto";

/** Compare-and-swap the password and revoke CLI sessions in one transaction. */
export async function updateAccountPassword(
  userId: string,
  previousHash: string | null,
  password: string,
) {
  const passwordHash = await hashPassword(password);
  return getDatabase().transaction(async (transaction) => {
    const now = new Date();
    const [updated] = await transaction
      .update(schema.users)
      .set({ passwordHash, updatedAt: now })
      .where(
        and(
          eq(schema.users.id, userId),
          previousHash === null
            ? isNull(schema.users.passwordHash)
            : eq(schema.users.passwordHash, previousHash),
        ),
      )
      .returning({ id: schema.users.id });
    if (!updated) return false;
    // Lock/remove device approvals before revoking tokens, so a concurrent
    // exchange must finish minting before the revocation statement runs.
    await transaction
      .delete(schema.cliDeviceAuthorizations)
      .where(eq(schema.cliDeviceAuthorizations.approvedBy, userId));
    await transaction
      .update(schema.cliAccessTokens)
      .set({ revokedAt: now, updatedAt: now })
      .where(eq(schema.cliAccessTokens.userId, userId));
    return true;
  });
}

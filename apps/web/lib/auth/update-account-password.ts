import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@codev/db";
import { getDatabase } from "../platform/database";
import { hashPassword } from "../platform/crypto";
import { revokeOtherUserSessions } from "./user-sessions";

/**
 * Compare-and-swap the password, then sign out every browser session except
 * `keepSessionId` and revoke CLI sessions, all in one transaction. Returns
 * the new hash, or null when the stored password changed underneath us.
 */
export async function updateAccountPassword(
  userId: string,
  previousHash: string | null,
  password: string,
  keepSessionId: string | null = null,
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
    if (!updated) return null;
    // Lock/remove device approvals before revoking tokens, so a concurrent
    // exchange must finish minting before the revocation statement runs.
    await transaction
      .delete(schema.cliDeviceAuthorizations)
      .where(eq(schema.cliDeviceAuthorizations.approvedBy, userId));
    await transaction
      .update(schema.cliAccessTokens)
      .set({ revokedAt: now, updatedAt: now })
      .where(eq(schema.cliAccessTokens.userId, userId));
    await revokeOtherUserSessions(userId, keepSessionId, transaction);
    return passwordHash;
  });
}

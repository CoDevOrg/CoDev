import "server-only";

import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { verifyPassword } from "../platform/crypto";
import { getDatabase } from "../platform/database";
import { consumeRateLimit } from "../platform/rate-limit";

export type CurrentPasswordCheck =
  | { ok: true; passwordHash: string }
  | { ok: false; message: string };

/**
 * Re-authenticates a signed-in member before a change a stolen session must
 * not make on its own (a new password, turning on 2FA). Five tries per 15
 * minutes, so a hijacked session cannot guess the password either.
 */
export async function confirmCurrentPassword(
  userId: string,
  password: string,
): Promise<CurrentPasswordCheck> {
  const limit = await consumeRateLimit(userId, "password-change", 5, 15 * 60);
  if (!limit.allowed)
    return {
      ok: false,
      message:
        "Too many attempts. Wait 15 minutes, or reset your password by email.",
    };
  const [row] = await getDatabase()
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!row?.passwordHash)
    return { ok: false, message: "This account does not have a password yet." };
  if (!(await verifyPassword(password, row.passwordHash)))
    return { ok: false, message: "That is not your current password." };
  return { ok: true, passwordHash: row.passwordHash };
}

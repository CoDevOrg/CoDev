import "server-only";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { verifyPassword } from "../platform/crypto";
import { getDatabase } from "../platform/database";
import { consumeRateLimit } from "../platform/rate-limit";
import type { AppUser } from "./identity";

const RECENT_SIGN_IN_MS = 15 * 60 * 1000;

/**
 * Re-authentication before a change a hijacked session could use to lock the
 * owner out (turning on 2FA with an attacker's authenticator). Accounts with
 * a password confirm it; OAuth-only accounts must have signed in recently.
 * Returns an error message or null.
 */
export async function verifyRecentAuthentication(
  user: AppUser,
  password: string,
) {
  const [row] = await getDatabase()
    .select({
      passwordHash: schema.users.passwordHash,
      signedInAt: schema.userSessions.createdAt,
    })
    .from(schema.users)
    .leftJoin(
      schema.userSessions,
      and(
        eq(schema.userSessions.id, user.sessionId ?? schema.users.id),
        eq(schema.userSessions.userId, schema.users.id),
      ),
    )
    .where(eq(schema.users.id, user.id))
    .limit(1);
  if (!row) return "Sign in again, then retry.";
  if (row.passwordHash) {
    const limit = await consumeRateLimit(
      user.id,
      "password-change",
      5,
      15 * 60,
    );
    if (!limit.allowed) return "Too many attempts. Wait 15 minutes.";
    return (await verifyPassword(password, row.passwordHash))
      ? null
      : "That is not your current password.";
  }
  return row.signedInAt &&
    Date.now() - row.signedInAt.getTime() < RECENT_SIGN_IN_MS
    ? null
    : "For your security, sign out and sign in again, then turn this on within 15 minutes.";
}

import "server-only";

import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { verifyPassword } from "../platform/crypto";
import { getDatabase } from "../platform/database";
import { consumeRateLimit } from "../platform/rate-limit";
import type { AppUser } from "./identity";
import { NEW_PASSWORD_MESSAGES, newPasswordProblem } from "./new-password";
import { recordSecurityEvent } from "./security-events";
import { sendSecurityNotice } from "./security-mail";
import { sessionRevision } from "./session-revision";
import { currentSessionIdFor, keepCurrentSession } from "./session-rotation";
import { updateAccountPassword } from "./update-account-password";
import { revokeUserSession } from "./user-sessions";

/**
 * Changes an existing password. Requires the current one (rate limited, so a
 * hijacked session cannot guess it), keeps this browser signed in, and signs
 * out every other session and CLI login. Returns an error message or null.
 */
export async function changePassword(
  user: AppUser,
  input: { current: string; password: string; confirm: string },
) {
  const limit = await consumeRateLimit(user.id, "password-change", 5, 15 * 60);
  if (!limit.allowed)
    return "Too many attempts. Wait 15 minutes, or reset your password by email.";

  const [row] = await getDatabase()
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);
  if (!row?.passwordHash) return "This account does not have a password yet.";
  if (!(await verifyPassword(input.current, row.passwordHash)))
    return "That is not your current password.";
  if (input.password === input.current)
    return "Choose a password different from your current one.";
  const problem = await newPasswordProblem(input.password, input.confirm);
  if (problem) return NEW_PASSWORD_MESSAGES[problem];

  const keep = await currentSessionIdFor(user);
  const passwordHash = await updateAccountPassword(
    user.id,
    row.passwordHash,
    input.password,
    keep,
  );
  if (!passwordHash) {
    // A pre-tracking browser got a row for this change; do not leave it listed.
    if (keep !== user.sessionId) await revokeUserSession(user.id, keep);
    return "Your password was changed somewhere else. Reload and try again.";
  }
  await keepCurrentSession(user, keep, sessionRevision(passwordHash));
  await recordSecurityEvent(user.id, "password_changed");
  await sendSecurityNotice(user.id, "password_changed");
  return null;
}

import "server-only";

import type { AppUser } from "./identity";
import { recordSecurityEvent } from "./security-events";
import { currentSessionIdFor, keepCurrentSession } from "./session-rotation";
import { revokeOtherUserSessions, revokeUserSession } from "./user-sessions";

/** Signs out one other browser. The current one signs out normally instead. */
export async function signOutSession(user: AppUser, sessionId: string) {
  if (sessionId === user.sessionId)
    return "Use Sign out to end the session you are using now.";
  if (!(await revokeUserSession(user.id, sessionId)))
    return "That session has already ended.";
  await recordSecurityEvent(user.id, "session_revoked");
  return null;
}

/** Signs out every other browser, including ones from before session tracking. */
export async function signOutOtherSessions(user: AppUser) {
  if (!user.credentialRevision) return "Sign in again, then retry.";
  const keep = await currentSessionIdFor(user);
  await revokeOtherUserSessions(user.id, keep);
  // A pre-tracking cookie was just revoked with the rest; move it to its row.
  if (keep !== user.sessionId)
    await keepCurrentSession(user, keep, user.credentialRevision);
  await recordSecurityEvent(user.id, "other_sessions_revoked");
  return null;
}

import "server-only";

import { unstable_update } from "@/auth";

import type { AppUser } from "./identity";
import { sealSessionRotation } from "./session-token";
import { createUserSession } from "./user-sessions";

/** The session row this browser keeps across a credential change. */
export async function currentSessionIdFor(user: AppUser) {
  return user.sessionId ?? createUserSession(user.id, "session", false);
}

/**
 * Re-issues this browser's cookie for its new credential revision or session
 * row, so the member who changed their password (or signed out everything
 * else) stays signed in while every other session is revoked.
 */
export async function keepCurrentSession(
  user: AppUser,
  toSessionId: string,
  credentialRevision: string,
) {
  await unstable_update({
    rotation: sealSessionRotation({
      userId: user.id,
      fromSessionId: user.sessionId ?? null,
      toSessionId,
      credentialRevision,
    }),
  });
}

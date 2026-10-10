import "server-only";

import type { Account, User } from "next-auth";
import type { JWT } from "next-auth/jwt";

import { sessionRevision } from "./session-revision";
import { openTicket, sealTicket } from "./signed-ticket";
import {
  adoptedSessionId,
  adoptLegacySession,
  readSessionState,
  touchUserSession,
} from "./user-sessions";

const ROTATION_PURPOSE = "session-rotation";

type SessionRotation = {
  userId: string;
  /** The session id the cookie must currently carry (null: pre-tracking). */
  fromSessionId: string | null;
  toSessionId: string;
  credentialRevision: string;
};

export function signInMethodFor(account: Account, user: User | undefined) {
  if (account.provider === "credentials") return "password";
  if (account.provider === "two-factor")
    return user?.signInMethod ?? "password";
  return account.provider;
}

export function sealSessionRotation(rotation: SessionRotation) {
  return sealTicket(ROTATION_PURPOSE, rotation, 60_000);
}

/**
 * Auth.js feeds `update()` payloads from both server actions and the public
 * `/api/auth/session` endpoint into the jwt callback. Only a server-signed,
 * one-minute ticket bound to this cookie's current session may move it to a
 * new credential revision or session row.
 */
export function applySessionRotation(token: JWT, payload: unknown) {
  const rotation = openTicket<SessionRotation>(
    ROTATION_PURPOSE,
    (payload as { rotation?: unknown } | undefined)?.rotation,
  );
  if (!rotation || rotation.userId !== token.localUserId) return;
  // A pre-tracking cookie may not carry its adopted row id yet.
  const currentSessionId =
    token.sid ??
    (typeof token.jti === "string"
      ? adoptedSessionId(rotation.userId, token.jti)
      : null);
  if (rotation.fromSessionId !== currentSessionId) return;
  token.sid = rotation.toSessionId;
  token.credentialRevision = rotation.credentialRevision;
}

/**
 * Runs on every authenticated request: the cookie must match the account's
 * current credentials and its session row must not be revoked. One query.
 */
export async function sessionTokenIsCurrent(
  token: JWT,
  adoptRevision: boolean,
) {
  if (!token.localUserId) return true;
  if (!token.sid && typeof token.jti === "string")
    token.sid = await adoptLegacySession(token.localUserId, token.jti);
  const state = await readSessionState(token.localUserId, token.sid);
  if (!state?.usable) return false;
  const revision = sessionRevision(state.passwordHash);
  if (adoptRevision) token.credentialRevision = revision;
  if (token.credentialRevision !== revision) return false;
  if (token.sid) touchUserSession(token.sid, state.lastSeenAt);
  return true;
}

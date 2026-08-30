import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";

import { schema } from "@codev/db";

import { getDatabase } from "./database";
import { INVITE_GRANT_COOKIE, openInviteGrant } from "./invite-grant";

/**
 * CoDev is invite-only: a new account may be created only when the email was
 * moved to `invited` on the waitlist AND the browser carries a valid invite
 * grant (from following the invite link). A short comma-separated
 * `SIGNUP_ALLOWLIST` env lets the founding team bypass the waitlist.
 *
 * This gate governs *account creation only*. Anyone who already has a `users`
 * row keeps signing in normally.
 */

export class RegistrationError extends Error {
  readonly code: "invite_required" | "invite_used" | "invite_expired";
  constructor(code: RegistrationError["code"], message: string) {
    super(message);
    this.name = "RegistrationError";
    this.code = code;
  }
}

type AllowlistEnv = Record<string, string | undefined>;

export function parseSignupAllowlist(
  env: AllowlistEnv = process.env,
): string[] {
  return (env.SIGNUP_ALLOWLIST ?? "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowlisted(
  email: string | null | undefined,
  env: AllowlistEnv = process.env,
): boolean {
  if (!email) return false;
  return parseSignupAllowlist(env).includes(email.trim().toLowerCase());
}

/** Reads and verifies the signed invite-grant cookie, if present. */
export async function readInviteGrant() {
  try {
    const raw = (await cookies()).get(INVITE_GRANT_COOKIE)?.value;
    return openInviteGrant(raw);
  } catch {
    return null;
  }
}

export type RegistrationDecision =
  | { allowed: true; via: "allowlist" }
  | { allowed: true; via: "invite"; requestId: string }
  | { allowed: false; code: RegistrationError["code"] };

/**
 * Decides whether `email` may create an account right now. `email` may be
 * undefined for a GitHub account with no public address — in that case only a
 * valid invite grant (which carries its own invited address) can authorize it.
 */
export async function evaluateRegistration(input: {
  email?: string | null | undefined;
}): Promise<RegistrationDecision> {
  if (isEmailAllowlisted(input.email)) {
    return { allowed: true, via: "allowlist" };
  }

  const grant = await readInviteGrant();
  if (!grant) {
    return { allowed: false, code: "invite_required" };
  }

  const [row] = await getDatabase()
    .select({
      id: schema.accessRequests.id,
      email: schema.accessRequests.email,
      status: schema.accessRequests.status,
      acceptedAt: schema.accessRequests.acceptedAt,
      inviteTokenExpiresAt: schema.accessRequests.inviteTokenExpiresAt,
    })
    .from(schema.accessRequests)
    .where(eq(schema.accessRequests.id, grant.requestId))
    .limit(1);

  if (!row || row.email.toLowerCase() !== grant.email.toLowerCase()) {
    return { allowed: false, code: "invite_required" };
  }
  if (row.acceptedAt) {
    return { allowed: false, code: "invite_used" };
  }
  if (row.status !== "invited") {
    return { allowed: false, code: "invite_required" };
  }
  if (
    row.inviteTokenExpiresAt &&
    row.inviteTokenExpiresAt.getTime() <= Date.now()
  ) {
    return { allowed: false, code: "invite_expired" };
  }

  return { allowed: true, via: "invite", requestId: row.id };
}

export async function assertCanRegister(input: {
  email?: string | null | undefined;
}): Promise<RegistrationDecision> {
  const decision = await evaluateRegistration(input);
  if (!decision.allowed) {
    const message =
      decision.code === "invite_used"
        ? "This invitation has already been used."
        : decision.code === "invite_expired"
          ? "This invitation link has expired. Ask us for a fresh one."
          : "CoDev is invite-only right now. Join the waitlist and we'll email you a link when you're in.";
    throw new RegistrationError(decision.code, message);
  }
  return decision;
}

/**
 * Retires the invitation once the account exists: stamps `accepted_at` and
 * clears the token so the link cannot be replayed. Best-effort — a failure
 * here must not undo a successful sign-up.
 */
export async function consumeInvite(requestId: string): Promise<void> {
  try {
    await getDatabase()
      .update(schema.accessRequests)
      .set({
        acceptedAt: new Date(),
        inviteTokenHash: null,
        inviteTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.accessRequests.id, requestId),
          isNull(schema.accessRequests.acceptedAt),
        ),
      );
  } catch (error) {
    console.error("Failed to mark access request accepted", error);
  }
}

export async function clearInviteGrantCookie(): Promise<void> {
  try {
    (await cookies()).delete(INVITE_GRANT_COOKIE);
  } catch {
    // Cookie mutation is best-effort; the grant is single-use and short-lived.
  }
}

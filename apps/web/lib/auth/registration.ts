import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { INVITE_GRANT_COOKIE, type InviteGrant } from "./invite-grant";

/**
 * CoDev is closed while the product is being prepared: no new account may be
 * created, including through an old invite link or the former allowlist.
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
  void email;
  void env;
  return false;
}

/** Registration is closed, so invite links are never surfaced as usable. */
export async function readInviteGrant(): Promise<InviteGrant | null> {
  return null;
}

export type RegistrationDecision =
  | { allowed: true; via: "allowlist" }
  | { allowed: true; via: "invite"; requestId: string }
  | { allowed: false; code: RegistrationError["code"] };

/**
 * Decides whether `email` may create an account right now. This remains a
 * separate function so every identity provider passes through the same closed
 * gate when registration is reopened.
 */
export async function evaluateRegistration(input: {
  email?: string | null | undefined;
}): Promise<RegistrationDecision> {
  // Deliberately do this before reading any grant. A stale invite or a
  // deployed SIGNUP_ALLOWLIST must never reopen registration by accident.
  void input;
  return { allowed: false, code: "invite_required" };
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
          : "CoDev is not accepting new accounts yet. Join the waitlist and we'll email you when registration opens.";
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

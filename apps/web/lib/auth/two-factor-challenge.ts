import "server-only";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { CredentialsSignin } from "next-auth";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { sessionRevision } from "./session-revision";
import { openTicket, sealTicket } from "./signed-ticket";
import {
  isTwoFactorEnabled,
  TwoFactorError,
  verifySecondFactor,
} from "./two-factor";

const PURPOSE = "two-factor-challenge";
const COOKIE = "codev-two-factor";
const TTL_SECONDS = 10 * 60;

export type FirstFactor = "password" | "google" | "github";

type Challenge = {
  userId: string;
  method: FirstFactor;
  credentialRevision: string;
};

/** Thrown from `authorize()` so the sign-in form moves to the code step. */
export class TwoFactorRequired extends CredentialsSignin {
  code = "two_factor_required";
}

export class TwoFactorRejected extends CredentialsSignin {
  constructor(reason: "invalid_code" | "rate_limited" | "expired") {
    super();
    this.code = reason;
  }
}

async function loadUser(userId: string) {
  const [user] = await getDatabase()
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      avatarUrl: schema.users.avatarUrl,
      passwordHash: schema.users.passwordHash,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return user ?? null;
}

/**
 * After a correct first factor, remembers it in a short-lived, httpOnly,
 * host-only cookie instead of starting a session. No session exists until the
 * second factor passes.
 */
export async function beginTwoFactorChallenge(
  userId: string,
  method: FirstFactor,
) {
  if (!(await isTwoFactorEnabled(userId))) return false;
  const user = await loadUser(userId);
  if (!user) return false;
  const ticket = sealTicket<Challenge>(
    PURPOSE,
    {
      userId,
      method,
      credentialRevision: sessionRevision(user.passwordHash),
    },
    TTL_SECONDS * 1000,
  );
  (await cookies()).set(COOKIE, ticket, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
  return true;
}

export async function readTwoFactorChallenge() {
  return openTicket<Challenge>(PURPOSE, (await cookies()).get(COOKIE)?.value);
}

/** `authorize()` for the `two-factor` provider: the challenge plus a code. */
export async function completeTwoFactorSignIn(code: unknown) {
  const challenge = await readTwoFactorChallenge();
  if (!challenge) throw new TwoFactorRejected("expired");
  if (typeof code !== "string" || !code.trim() || code.length > 32)
    throw new TwoFactorRejected("invalid_code");
  const user = await loadUser(challenge.userId);
  // A password change since the first factor voids the challenge.
  const credentialRevision = sessionRevision(user?.passwordHash ?? null);
  if (!user || credentialRevision !== challenge.credentialRevision)
    throw new TwoFactorRejected("expired");
  try {
    await verifySecondFactor(user.id, code.trim());
  } catch (error) {
    if (error instanceof TwoFactorError)
      throw new TwoFactorRejected(
        error.reason === "rate_limited" ? "rate_limited" : "invalid_code",
      );
    throw error;
  }
  (await cookies()).delete(COOKIE);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.avatarUrl,
    credentialRevision,
    signInMethod: challenge.method,
  };
}

/** Same-site relative paths only, so the code step cannot become an open redirect. */
export function safeCallbackPath(value: string | null | undefined) {
  return value?.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
    ? value
    : "/gen2";
}

export function twoFactorChallengePath(callbackUrl: string | null | undefined) {
  return `/sign-in/two-factor?callbackUrl=${encodeURIComponent(safeCallbackPath(callbackUrl))}`;
}

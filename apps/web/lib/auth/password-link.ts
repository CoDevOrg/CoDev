import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";
import { after } from "next/server";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { consumeRateLimit } from "../platform/rate-limit";
import { NEW_PASSWORD_MESSAGES, newPasswordProblem } from "./new-password";
import {
  createPasswordResetToken,
  getPublicAppOrigin,
  openPasswordResetToken,
  passwordResetTokenStillValid,
  shouldSendPasswordReset,
} from "./password-reset";
import { sendPasswordResetEmail } from "./password-reset-mail";
import { readRequestContext } from "./request-context";
import { recordSecurityEvent } from "./security-events";
import { sendSecurityNotice } from "./security-mail";
import {
  isTwoFactorEnabled,
  TwoFactorError,
  verifySecondFactor,
} from "./two-factor";
import { updateAccountPassword } from "./update-account-password";

async function loadAccount(where: { id: string } | { email: string }) {
  const [user] = await getDatabase()
    .select({
      id: schema.users.id,
      email: schema.users.email,
      passwordHash: schema.users.passwordHash,
    })
    .from(schema.users)
    .where(
      "id" in where
        ? eq(schema.users.id, where.id)
        : eq(schema.users.email, where.email),
    )
    .limit(1);
  return user ?? null;
}

async function sendLink(user: Awaited<ReturnType<typeof loadAccount>>) {
  if (!shouldSendPasswordReset(user) || !user?.email) return false;
  const token = createPasswordResetToken({
    userId: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
  });
  await sendPasswordResetEmail(
    user.email,
    `${getPublicAppOrigin()}/reset-password?token=${encodeURIComponent(token)}`,
    Boolean(user.passwordHash),
  );
  return true;
}

/**
 * The public "forgot password" form. The lookup and email happen after the
 * response, so neither its content nor its timing reveals whether an
 * account exists.
 */
export async function requestPasswordLink(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@") || normalized.length > 320) return;
  const { ipAddress } = await readRequestContext();
  const [emailLimit, ipLimit] = await Promise.all([
    consumeRateLimit(normalized, "password-reset", 5, 60 * 60),
    consumeRateLimit(ipAddress ?? "unknown", "password-reset-ip", 10, 60 * 60),
  ]);
  if (!emailLimit.allowed || !ipLimit.allowed) return;
  after(async () => {
    try {
      await sendLink(await loadAccount({ email: normalized }));
    } catch (error) {
      console.error("Unable to process a password reset request.", error);
    }
  });
}

/** Settings: a signed-in member asks for a link to set or reset their password. */
export async function emailPasswordLinkToSelf(userId: string) {
  const limit = await consumeRateLimit(userId, "password-link", 3, 15 * 60);
  if (!limit.allowed)
    return "We already sent a few links. Wait 15 minutes before asking again.";
  const sent = await sendLink(await loadAccount({ id: userId }));
  if (!sent) return "Your account has no email address to send a link to.";
  await recordSecurityEvent(userId, "password_link_sent");
  return null;
}

/** What the link page needs to render, or null when the link is unusable. */
export async function describePasswordLink(token: string) {
  const state = openPasswordResetToken(token);
  if (!state) return null;
  const [user] = await getDatabase()
    .select({
      id: schema.users.id,
      email: schema.users.email,
      passwordHash: schema.users.passwordHash,
      twoFactor: schema.userTwoFactor.userId,
    })
    .from(schema.users)
    .leftJoin(
      schema.userTwoFactor,
      and(
        eq(schema.userTwoFactor.userId, schema.users.id),
        isNotNull(schema.userTwoFactor.enabledAt),
      ),
    )
    .where(eq(schema.users.id, state.userId))
    .limit(1);
  if (!user || !passwordResetTokenStillValid(state, user)) return null;
  return {
    hasPassword: Boolean(user.passwordHash),
    requiresCode: Boolean(user.twoFactor),
  };
}

export type PasswordLinkResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "retry"; message: string };

/** Completes an emailed link. Accounts with 2FA must also give a code. */
export async function completePasswordLink(input: {
  token: string;
  password: string;
  confirm: string;
  code: string;
}): Promise<PasswordLinkResult> {
  const invalid = {
    ok: false,
    error: "invalid",
    message: "This link is invalid or has expired. Request a new one.",
  } as const;
  const state = openPasswordResetToken(input.token);
  const user = state ? await loadAccount({ id: state.userId }) : null;
  if (!state || !passwordResetTokenStillValid(state, user)) return invalid;
  const problem = await newPasswordProblem(input.password, input.confirm);
  if (problem)
    return {
      ok: false,
      error: "retry",
      message: NEW_PASSWORD_MESSAGES[problem],
    };
  if (await isTwoFactorEnabled(user!.id)) {
    try {
      await verifySecondFactor(user!.id, input.code.trim());
    } catch (error) {
      if (!(error instanceof TwoFactorError)) throw error;
      const message =
        error.reason === "rate_limited"
          ? "Too many codes tried. Wait 15 minutes and try again."
          : "Enter a current code from your authenticator app, or a recovery code.";
      return { ok: false, error: "retry", message };
    }
  }
  if (
    !(await updateAccountPassword(user!.id, user!.passwordHash, input.password))
  )
    return invalid;
  await recordSecurityEvent(user!.id, "password_reset");
  await sendSecurityNotice(user!.id, "password_reset");
  return { ok: true };
}

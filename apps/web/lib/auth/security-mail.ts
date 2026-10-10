import "server-only";

import { eq } from "drizzle-orm";
import { after } from "next/server";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { sendAuthEmail } from "./auth-mail";
import { getPublicAppOrigin } from "./password-reset";
import { readRequestContext } from "./request-context";
import { describeUserAgent } from "./user-agent";

const NOTICES = {
  password_changed: [
    "Your CoDev password was changed",
    "The password for your CoDev account was just changed. Your other sessions and CLI logins were signed out.",
  ],
  password_reset: [
    "Your CoDev password was reset",
    "The password for your CoDev account was just set from an emailed link. Every session and CLI login was signed out.",
  ],
  two_factor_enabled: [
    "Two-factor authentication is on",
    "Two-factor authentication was turned on for your CoDev account. Signing in now also needs a code from your authenticator app.",
  ],
  two_factor_disabled: [
    "Two-factor authentication is off",
    "Two-factor authentication was turned off for your CoDev account. Signing in no longer asks for an authenticator code.",
  ],
  recovery_code_used: [
    "A CoDev recovery code was used",
    "One of your two-factor recovery codes was just used to sign in. Each code works once; generate new ones in Settings if you are running low.",
  ],
} as const;

export type SecurityNotice = keyof typeof NOTICES;

/**
 * Emails the account owner after a security change, after the response is
 * sent so the request is not slowed (or timed) by the mail provider.
 */
export async function sendSecurityNotice(
  userId: string,
  notice: SecurityNotice,
) {
  const context = await readRequestContext();
  const send = async () => {
    const [user] = await getDatabase()
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user?.email) return;
    const [subject, body] = NOTICES[notice];
    const where = [
      describeUserAgent(context.userAgent).label,
      context.ipAddress,
    ].filter(Boolean);
    await sendAuthEmail(
      user.email,
      subject,
      [
        body,
        "",
        `When: ${new Date().toUTCString()}`,
        `From: ${where.join(" · ") || "unknown"}`,
        "",
        `If this was not you, reset your password now: ${getPublicAppOrigin()}/forgot-password`,
        `Review your sessions: ${getPublicAppOrigin()}/settings/personal/sessions`,
      ].join("\n"),
    );
  };
  try {
    after(send);
  } catch {
    await send().catch(() => undefined);
  }
}

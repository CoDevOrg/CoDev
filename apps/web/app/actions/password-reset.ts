"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { schema } from "@codev/db";

import { hashPassword } from "@/lib/crypto";
import { getDatabase } from "@/lib/database";
import { getNewAccountPasswordError } from "@/lib/password-policy";
import {
  createPasswordResetToken,
  getPublicAppOrigin,
  openPasswordResetToken,
  passwordResetTokenStillValid,
  shouldSendPasswordReset,
} from "@/lib/password-reset";
import { sendPasswordResetEmail } from "@/lib/password-reset-mail";
import { consumeRateLimit } from "@/lib/rate-limit";

function normalizeEmail(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function clientIp() {
  const forwarded = (await headers()).get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export async function requestPasswordReset(formData: FormData) {
  const email = normalizeEmail(formData.get("email"));
  if (!email || !email.includes("@")) {
    redirect("/forgot-password?sent=1");
  }

  const ip = await clientIp();
  const [emailLimit, ipLimit] = await Promise.all([
    consumeRateLimit(email, "password-reset", 5, 60 * 60),
    consumeRateLimit(ip, "password-reset-ip", 10, 60 * 60),
  ]);
  if (!emailLimit.allowed || !ipLimit.allowed) {
    redirect("/forgot-password?sent=1");
  }

  try {
    const [user] = await getDatabase()
      .select({
        id: schema.users.id,
        email: schema.users.email,
        passwordHash: schema.users.passwordHash,
      })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (
      shouldSendPasswordReset(user ?? null) &&
      user?.email &&
      user.passwordHash
    ) {
      const token = createPasswordResetToken({
        userId: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
      });
      await sendPasswordResetEmail(
        user.email,
        `${getPublicAppOrigin()}/reset-password?token=${encodeURIComponent(token)}`,
      );
    }
  } catch (error) {
    console.error("Unable to process a password reset request.", error);
  }

  redirect("/forgot-password?sent=1");
}

export async function completePasswordReset(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const state = openPasswordResetToken(token);

  if (!state) {
    redirect("/reset-password?error=invalid");
  }

  if (password !== confirm) {
    redirect(`/reset-password?error=match&token=${encodeURIComponent(token)}`);
  }

  const policyError = getNewAccountPasswordError(password);
  if (policyError) {
    redirect(`/reset-password?error=policy&token=${encodeURIComponent(token)}`);
  }

  const [user] = await getDatabase()
    .select({
      id: schema.users.id,
      email: schema.users.email,
      passwordHash: schema.users.passwordHash,
    })
    .from(schema.users)
    .where(eq(schema.users.id, state.userId))
    .limit(1);

  if (!passwordResetTokenStillValid(state, user ?? null)) {
    redirect("/reset-password?error=invalid");
  }

  await getDatabase()
    .update(schema.users)
    .set({
      passwordHash: await hashPassword(password),
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, state.userId));

  redirect("/sign-in?reset=1");
}

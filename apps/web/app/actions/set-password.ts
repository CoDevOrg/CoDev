"use server";

import { redirect } from "next/navigation";

import { updateAccountPassword } from "@/lib/auth/update-account-password";
import { getNewAccountPasswordError } from "@/lib/auth/password-policy";
import { requireUser } from "@/lib/auth/session";

/**
 * Lets an already-signed-in user (typically OAuth-only, no password yet) add
 * a password to their account. Only ever writes when the account's
 * `passwordHash` is still null — an account that already has one must go
 * through the email-based reset flow instead, so a hijacked session can't
 * silently overwrite an existing password.
 */
export async function setAccountPassword(
  redirectTo: string,
  formData: FormData,
) {
  const user = await requireUser();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password !== confirm) {
    redirect(`${redirectTo}?error=match`);
  }

  const policyError = getNewAccountPasswordError(password);
  if (policyError) {
    redirect(`${redirectTo}?error=policy`);
  }

  const updated = await updateAccountPassword(user.id, null, password);

  if (!updated) {
    redirect(`${redirectTo}?error=exists`);
  }

  redirect(`${redirectTo}?password=set`);
}

"use server";

import { redirect } from "next/navigation";

import {
  completePasswordLink,
  requestPasswordLink,
} from "@/lib/auth/password-link";

/** The answer is identical whether or not the address has an account. */
export async function requestPasswordReset(formData: FormData) {
  await requestPasswordLink(String(formData.get("email") ?? ""));
  redirect("/forgot-password?sent=1");
}

export type PasswordResetState = { error: string | null };

export async function completePasswordReset(
  _: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  const token = String(formData.get("token") ?? "");
  const result = await completePasswordLink({
    token,
    password: String(formData.get("password") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
    code: String(formData.get("code") ?? ""),
  });
  if (result.ok) redirect("/sign-in?reset=1");
  if (result.error === "invalid") redirect("/reset-password?error=invalid");
  return { error: result.message };
}

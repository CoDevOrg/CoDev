"use server";

import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";

import { schema } from "@codev/db";

import { hashPassword } from "@/lib/crypto";
import { getDatabase } from "@/lib/database";
import { getNewAccountPasswordError } from "@/lib/password-policy";
import { requireUser } from "@/lib/session";

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

  const [updated] = await getDatabase()
    .update(schema.users)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(and(eq(schema.users.id, user.id), isNull(schema.users.passwordHash)))
    .returning({ id: schema.users.id });

  if (!updated) {
    redirect(`${redirectTo}?error=exists`);
  }

  redirect(`${redirectTo}?password=set`);
}

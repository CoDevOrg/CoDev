"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { schema } from "@codev/db";

import { unstable_update } from "@/auth";
import { updateAccountPassword } from "@/lib/auth/update-account-password";
import { getNewAccountPasswordError } from "@/lib/auth/password-policy";
import { requireUser } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/platform/crypto";
import { getDatabase } from "@/lib/platform/database";

const PROFILE_PATH = "/settings/personal/profile";
const MAX_DISPLAY_NAME_LENGTH = 80;

export async function updateDisplayName(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "")
    .trim()
    .replace(/\s+/g, " ");

  if (!name || name.length > MAX_DISPLAY_NAME_LENGTH) {
    redirect(`${PROFILE_PATH}?error=name`);
  }

  await getDatabase()
    .update(schema.users)
    .set({ name, updatedAt: new Date() })
    .where(eq(schema.users.id, user.id));

  // The session token carries the name shown in the app shell. Refreshing it
  // is best effort: the database is already correct, and the token catches up
  // at the next sign-in if this fails.
  try {
    await unstable_update({ user: { name } });
  } catch {
    // Intentionally ignored.
  }

  revalidatePath("/settings", "layout");
  redirect(`${PROFILE_PATH}?name=saved`);
}

/**
 * Changes the password of an account that already has one. Unlike
 * `setAccountPassword`, which only ever fills an empty hash, this requires the
 * current password, so a hijacked session alone cannot overwrite it.
 */
export async function changeAccountPassword(
  redirectTo: string,
  formData: FormData,
) {
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const [row] = await getDatabase()
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);

  if (!row?.passwordHash) {
    redirect(`${redirectTo}?error=nopassword`);
  }
  if (!(await verifyPassword(current, row.passwordHash))) {
    redirect(`${redirectTo}?error=current`);
  }
  if (password !== confirm) {
    redirect(`${redirectTo}?error=match`);
  }
  if (getNewAccountPasswordError(password)) {
    redirect(`${redirectTo}?error=policy`);
  }

  if (!(await updateAccountPassword(user.id, row.passwordHash, password))) {
    redirect(`${redirectTo}?error=current`);
  }

  redirect(`${redirectTo}?password=changed`);
}

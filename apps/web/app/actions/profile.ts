"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { schema } from "@codev/db";

import { unstable_update } from "@/auth";
import { requireUser } from "@/lib/auth/session";
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

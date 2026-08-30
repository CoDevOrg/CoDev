import "server-only";

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { schema } from "@codev/db";

import { getDatabase } from "./database";
import { requireUser } from "./session";
import type { AppUser } from "./identity";

/**
 * Application-wide administrator check. This is deliberately separate from the
 * per-workspace role system (`workspace_members.role`): an admin governs the
 * whole product surface — the internal `/admin` console — not a single
 * workspace.
 */
export async function isUserAdmin(userId: string): Promise<boolean> {
  if (!userId) return false;
  const [row] = await getDatabase()
    .select({ isAdmin: schema.users.isAdmin })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return Boolean(row?.isAdmin);
}

/**
 * Guards an admin-only route. A signed-out visitor is bounced to `/sign-in`
 * (via {@link requireUser}); a signed-in non-admin gets a 404 so the console's
 * existence is not advertised.
 */
export async function requireAdmin(): Promise<AppUser> {
  const user = await requireUser();
  if (!(await isUserAdmin(user.id))) {
    notFound();
  }
  return user;
}

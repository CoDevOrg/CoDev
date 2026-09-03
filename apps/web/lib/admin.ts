import "server-only";

import { cache } from "react";
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
 *
 * AppChrome calls this on every authenticated sidebar page, and routes under
 * `/admin` also call it via requireAdmin() — cache() dedupes those to one DB
 * lookup per request instead of one per call site.
 */
export const isUserAdmin = cache(async (userId: string): Promise<boolean> => {
  if (!userId) return false;
  try {
    const [row] = await getDatabase()
      .select({ isAdmin: schema.users.isAdmin })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return Boolean(row?.isAdmin);
  } catch (error) {
    // If the lookup fails (e.g. the `is_admin` migration has not run yet on
    // this environment), degrade to "not an admin" rather than taking down
    // the whole app shell.
    console.error("isUserAdmin lookup failed", error);
    return false;
  }
});

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

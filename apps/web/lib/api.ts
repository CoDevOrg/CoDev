import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { authenticateCliRequest, CliAuthError } from "@/lib/cli-auth";
import { getDatabase } from "@/lib/database";
import { type AppUser, getCurrentAppUser } from "@/lib/identity";

export async function getApiUser() {
  return getCurrentAppUser();
}

/**
 * Resolves the caller via a `codev_cli_...` bearer token first (mobile app,
 * CLI), falling back to the cookie session (web app). Only wire this into
 * routes that a non-browser client actually calls — `getApiUser()` covers
 * every other route and needs no change.
 */
export async function getApiUserAnyAuth(
  request: Request,
): Promise<AppUser | null> {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    try {
      const token = await authenticateCliRequest(request);
      const [user] = await getDatabase()
        .select({
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.users)
        .where(eq(schema.users.id, token.userId))
        .limit(1);
      if (!user) return null;
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.avatarUrl,
      };
    } catch (error) {
      if (error instanceof CliAuthError) return null;
      throw error;
    }
  }
  return getCurrentAppUser();
}

export function apiError(error: unknown, status = 400) {
  const message =
    error instanceof Error
      ? error.message
      : "The request could not be completed.";
  return Response.json({ error: message }, { status });
}

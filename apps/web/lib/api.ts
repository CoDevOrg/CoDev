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

const GENERIC_API_ERROR = "Something went wrong on our end. Please try again.";

/**
 * Postgres and Drizzle put the failed statement *and its bound parameters*
 * into `Error.message` — `Failed query: insert into "workspaces" ... params:
 * 464b50d7-...`. Forwarding that to the browser publishes the schema along
 * with whatever user data was in the parameters, and tells the person who
 * clicked the button nothing they can act on. The cause worth having is in
 * `error.cause` (the driver error, with the constraint name and SQLSTATE),
 * and it belongs in the server log rather than in a dialog.
 */
function isDatabaseError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === "DrizzleQueryError") return true;
  if (error.message.startsWith("Failed query:")) return true;
  // node-postgres DatabaseError reports a bare "error" as its name, so it is
  // identified by the protocol fields it copies off the wire instead.
  return (
    "severity" in error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

/**
 * Turn a thrown error into a JSON response.
 *
 * This codebase's idiom is `apiError(new Error("Workspace not found."), 404)`
 * — a sentence written for the person on the other end — so a message is
 * passed through by default. The exception is an error that escaped from the
 * infrastructure beneath a route rather than being written for a reader:
 * those become one generic sentence, and the detail is logged instead of
 * rendered.
 */
export function apiError(error: unknown, status = 400) {
  const fromDatabase = isDatabaseError(error);
  if (fromDatabase || status >= 500) {
    console.error("[api] request failed", error);
  }
  if (fromDatabase) {
    return Response.json({ error: GENERIC_API_ERROR }, { status: 500 });
  }

  const message =
    error instanceof Error
      ? error.message
      : "The request could not be completed.";
  return Response.json({ error: message }, { status });
}

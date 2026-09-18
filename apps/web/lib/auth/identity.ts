import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { auth as nextAuth } from "@/auth";

import { getDatabase } from "../platform/database";
import { resolveGithubConnection } from "../github/github";

export type AppUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  githubLogin?: string;
};

export type ConnectedAccounts = {
  google: {
    connected: boolean;
  };
  github: {
    connected: boolean;
    login: string | null;
  };
  sameCoDevUser: boolean;
  hasPassword: boolean;
};

export async function getConnectedAccounts(
  userId: string,
): Promise<ConnectedAccounts> {
  const [[record], github] = await Promise.all([
    getDatabase()
      .select({
        googleUserId: schema.users.googleUserId,
        passwordHash: schema.users.passwordHash,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1),
    resolveGithubConnection(userId),
  ]);

  const googleConnected = Boolean(record?.googleUserId);

  return {
    google: { connected: googleConnected },
    github,
    sameCoDevUser: googleConnected && github.connected,
    hasPassword: Boolean(record?.passwordHash),
  };
}

// Multiple layouts/pages in the same route tree call this (e.g. a segment's
// layout and its page both need the current user) — cache() dedupes those to
// one session/DB round trip per request instead of one per call site.
export const getCurrentAppUser = cache(async (): Promise<AppUser | null> => {
  const session = await nextAuth();
  return session?.user ?? null;
});

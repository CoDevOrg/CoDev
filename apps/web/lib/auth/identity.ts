import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { auth as nextAuth } from "@/auth";

import { getDatabase } from "../platform/database";

export type AppUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  githubLogin?: string;
  credentialRevision?: string;
  sessionId?: string;
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
  // One round trip: the database is ~70 ms from the web origin.
  const [record] = await getDatabase()
    .select({
      googleUserId: schema.users.googleUserId,
      passwordHash: schema.users.passwordHash,
      githubUserId: schema.users.githubUserId,
      login: schema.users.login,
      connectionUserId: schema.githubConnections.userId,
    })
    .from(schema.users)
    .leftJoin(
      schema.githubConnections,
      eq(schema.githubConnections.userId, schema.users.id),
    )
    .where(eq(schema.users.id, userId))
    .limit(1);

  const googleConnected = Boolean(record?.googleUserId);
  // Same rule as resolveGithubConnection: a linked id and a stored token.
  const githubConnected = Boolean(
    record?.githubUserId != null && record.connectionUserId,
  );

  return {
    google: { connected: googleConnected },
    github: {
      connected: githubConnected,
      login: githubConnected ? (record?.login ?? null) : null,
    },
    sameCoDevUser: googleConnected && githubConnected,
    hasPassword: Boolean(record?.passwordHash),
  };
}

// Multiple layouts/pages in the same route tree call this (e.g. a segment's
// layout and its page both need the current user) — cache() dedupes those to
// one session/DB round trip per request instead of one per call site.
export const getCurrentAppUser = cache(async (): Promise<AppUser | null> => {
  const session = await nextAuth();
  return session?.user
    ? {
        ...session.user,
        ...(session.credentialRevision
          ? { credentialRevision: session.credentialRevision }
          : {}),
        ...(session.sessionId ? { sessionId: session.sessionId } : {}),
      }
    : null;
});

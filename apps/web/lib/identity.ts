import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { auth as clerkAuth, currentUser } from "@clerk/nextjs/server";

import { schema } from "@codev/db";

import { auth as nextAuth } from "@/auth";

import { getDatabase } from "./database";
import { resolveGithubConnection } from "./github";
import { deriveClerkLogin } from "./identity-profile";

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

export function clerkAuthConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    process.env.CLERK_SECRET_KEY,
  );
}

// Columns needed both to identify an existing row and to detect whether the
// Clerk profile actually changed anything worth writing back.
const userSyncColumns = {
  id: schema.users.id,
  clerkUserId: schema.users.clerkUserId,
  login: schema.users.login,
  name: schema.users.name,
  email: schema.users.email,
  avatarUrl: schema.users.avatarUrl,
};

async function ensureClerkUser(clerkUserId: string): Promise<AppUser | null> {
  const profile = await currentUser();
  if (!profile || profile.id !== clerkUserId) return null;
  const email = profile.primaryEmailAddress?.emailAddress ?? null;
  const login = deriveClerkLogin(profile);
  const name =
    [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() ||
    profile.username ||
    null;
  const avatarUrl = profile.imageUrl;

  const database = getDatabase();
  const [existingByClerk] = await database
    .select(userSyncColumns)
    .from(schema.users)
    .where(eq(schema.users.clerkUserId, clerkUserId))
    .limit(1);
  // Only fall back to an email match (pre-Clerk account linking) when the
  // clerkUserId lookup above didn't already resolve it — running both on
  // every request just to discard one result was pure waste.
  const existing =
    existingByClerk ??
    (email
      ? (
          await database
            .select(userSyncColumns)
            .from(schema.users)
            .where(eq(schema.users.email, email))
            .limit(1)
        )[0]
      : undefined);

  const returning = { id: schema.users.id };
  let localUser: { id: string } | undefined;
  if (existing) {
    const unchanged =
      existing.clerkUserId === clerkUserId &&
      existing.login === login &&
      existing.name === name &&
      existing.email === email &&
      existing.avatarUrl === avatarUrl;
    // Skip the write entirely when Clerk's profile matches what's already
    // stored — this runs on every authenticated page view, so an
    // unconditional UPDATE there was a write on every single navigation.
    localUser = unchanged
      ? { id: existing.id }
      : (
          await database
            .update(schema.users)
            .set({
              clerkUserId,
              login,
              name,
              email,
              avatarUrl,
              updatedAt: new Date(),
            })
            .where(eq(schema.users.id, existing.id))
            .returning(returning)
        )[0];
  } else {
    [localUser] = await database
      .insert(schema.users)
      .values({
        clerkUserId,
        githubUserId: null,
        login,
        name,
        email,
        avatarUrl,
      })
      .returning(returning);
  }

  if (!localUser) return null;
  const connectedAccounts = await getConnectedAccounts(localUser.id);
  return {
    id: localUser.id,
    name,
    email,
    image: avatarUrl,
    ...(connectedAccounts.github.connected && connectedAccounts.github.login
      ? { githubLogin: connectedAccounts.github.login }
      : {}),
  };
}

// Multiple layouts/pages in the same route tree call this (e.g. a segment's
// layout and its page both need the current user) — cache() dedupes those to
// one Clerk/DB round trip per request instead of one per call site.
export const getCurrentAppUser = cache(async (): Promise<AppUser | null> => {
  if (clerkAuthConfigured()) {
    const { userId } = await clerkAuth();
    return userId ? ensureClerkUser(userId) : null;
  }
  const session = await nextAuth();
  return session?.user ?? null;
});

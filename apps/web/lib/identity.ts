import "server-only";

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

async function ensureClerkUser(clerkUserId: string): Promise<AppUser | null> {
  const profile = await currentUser();
  if (!profile || profile.id !== clerkUserId) return null;
  const email = profile.primaryEmailAddress?.emailAddress ?? null;
  const login = deriveClerkLogin(profile);
  const name =
    [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() ||
    profile.username ||
    null;
  const database = getDatabase();
  const [existingByClerk] = await database
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.clerkUserId, clerkUserId))
    .limit(1);
  const [existingByEmail] = email
    ? await database
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1)
    : [];
  const existingId = existingByClerk?.id ?? existingByEmail?.id;
  const returning = { id: schema.users.id };
  const [localUser] = existingId
    ? await database
        .update(schema.users)
        .set({
          clerkUserId,
          login,
          name,
          email,
          avatarUrl: profile.imageUrl,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, existingId))
        .returning(returning)
    : await database
        .insert(schema.users)
        .values({
          clerkUserId,
          githubUserId: null,
          login,
          name,
          email,
          avatarUrl: profile.imageUrl,
        })
        .returning(returning);

  if (!localUser) return null;
  const connectedAccounts = await getConnectedAccounts(localUser.id);
  return {
    id: localUser.id,
    name,
    email,
    image: profile.imageUrl,
    ...(connectedAccounts.github.connected && connectedAccounts.github.login
      ? { githubLogin: connectedAccounts.github.login }
      : {}),
  };
}

export async function getCurrentAppUser(): Promise<AppUser | null> {
  if (clerkAuthConfigured()) {
    const { userId } = await clerkAuth();
    return userId ? ensureClerkUser(userId) : null;
  }
  const session = await nextAuth();
  return session?.user ?? null;
}

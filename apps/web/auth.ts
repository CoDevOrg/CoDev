import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { schema } from "@codev/db";

import { encryptSecret, hashPassword, verifyPassword } from "@/lib/crypto";
import { getDatabase } from "@/lib/database";

interface GitHubProfile {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface GoogleProfile {
  sub?: string;
  id?: string;
  name?: string | null;
  email?: string | null;
  picture?: string | null;
  email_verified?: boolean;
}

const githubClientId =
  process.env.AUTH_GITHUB_ID ?? "github-app-not-configured";
const githubClientSecret =
  process.env.AUTH_GITHUB_SECRET ?? "github-app-not-configured";
const googleClientId =
  process.env.AUTH_GOOGLE_ID ?? "google-auth-not-configured";
const googleClientSecret =
  process.env.AUTH_GOOGLE_SECRET ?? "google-auth-not-configured";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        name: { label: "Name", type: "text" },
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const name =
          typeof credentials?.name === "string" ? credentials.name.trim() : "";
        const email =
          typeof credentials?.email === "string"
            ? credentials.email.trim().toLowerCase()
            : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";

        if (!name || !email || password.length < 8) return null;

        const database = getDatabase();
        const [existingUser] = await database
          .select({
            id: schema.users.id,
            name: schema.users.name,
            email: schema.users.email,
            avatarUrl: schema.users.avatarUrl,
            passwordHash: schema.users.passwordHash,
          })
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1);

        if (existingUser) {
          if (
            !existingUser.passwordHash ||
            !(await verifyPassword(password, existingUser.passwordHash))
          ) {
            return null;
          }

          return {
            id: existingUser.id,
            name: existingUser.name,
            email: existingUser.email,
            image: existingUser.avatarUrl,
          };
        }

        const [localUser] = await database
          .insert(schema.users)
          .values({
            login: `local-${randomBytes(8).toString("hex")}`,
            name,
            email,
            passwordHash: await hashPassword(password),
          })
          .returning({
            id: schema.users.id,
            name: schema.users.name,
            email: schema.users.email,
            avatarUrl: schema.users.avatarUrl,
          });

        return localUser
          ? {
              id: localUser.id,
              name: localUser.name,
              email: localUser.email,
              image: localUser.avatarUrl,
            }
          : null;
      },
    }),
    GitHub({
      clientId: githubClientId,
      clientSecret: githubClientSecret,
    }),
    Google({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "google") {
        const googleProfile = profile as unknown as GoogleProfile | undefined;
        if (!googleProfile?.email || googleProfile.email_verified === false) {
          return false;
        }

        const database = getDatabase();
        const now = new Date();
        const [existingByEmail] = await database
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, googleProfile.email))
          .limit(1);
        const [localUser] = existingByEmail
          ? await database
              .update(schema.users)
              .set({
                name: googleProfile.name ?? null,
                email: googleProfile.email,
                avatarUrl: googleProfile.picture ?? null,
                updatedAt: now,
              })
              .where(eq(schema.users.id, existingByEmail.id))
              .returning({ id: schema.users.id })
          : await database
              .insert(schema.users)
              .values({
                login: `google-${googleProfile.sub ?? googleProfile.id ?? "user"}`,
                name: googleProfile.name ?? null,
                email: googleProfile.email,
                avatarUrl: googleProfile.picture ?? null,
              })
              .returning({ id: schema.users.id });

        return Boolean(localUser);
      }

      if (
        account?.provider !== "github" ||
        !account.access_token ||
        !profile ||
        !process.env.CREDENTIAL_ENCRYPTION_KEY
      ) {
        return false;
      }

      const githubProfile = profile as unknown as GitHubProfile;
      const now = new Date();
      const database = getDatabase();
      const githubUserId = BigInt(githubProfile.id);
      const [existingByGithub] = await database
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.githubUserId, githubUserId))
        .limit(1);
      const [existingByEmail] = githubProfile.email
        ? await database
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(eq(schema.users.email, githubProfile.email))
            .limit(1)
        : [];
      const [localUser] =
        existingByGithub?.id || existingByEmail?.id
          ? await database
              .update(schema.users)
              .set({
                githubUserId,
                login: githubProfile.login,
                name: githubProfile.name,
                email: githubProfile.email,
                avatarUrl: githubProfile.avatar_url,
                updatedAt: now,
              })
              .where(
                eq(
                  schema.users.id,
                  existingByGithub?.id ?? existingByEmail!.id,
                ),
              )
              .returning({ id: schema.users.id })
          : await database
              .insert(schema.users)
              .values({
                githubUserId,
                login: githubProfile.login,
                name: githubProfile.name,
                email: githubProfile.email,
                avatarUrl: githubProfile.avatar_url,
              })
              .returning({ id: schema.users.id });

      if (!localUser) {
        return false;
      }

      const refreshTokenExpiresIn = (
        account as typeof account & { refresh_token_expires_in?: number }
      ).refresh_token_expires_in;

      await getDatabase()
        .insert(schema.githubConnections)
        .values({
          userId: localUser.id,
          encryptedAccessToken: await encryptSecret(account.access_token),
          encryptedRefreshToken: account.refresh_token
            ? await encryptSecret(account.refresh_token)
            : null,
          accessTokenExpiresAt: account.expires_at
            ? new Date(account.expires_at * 1000)
            : null,
          refreshTokenExpiresAt: refreshTokenExpiresIn
            ? new Date(Date.now() + refreshTokenExpiresIn * 1000)
            : null,
          tokenType: account.token_type ?? "bearer",
          scope: account.scope ?? null,
          keyVersion: 2,
        })
        .onConflictDoUpdate({
          target: schema.githubConnections.userId,
          set: {
            encryptedAccessToken: await encryptSecret(account.access_token),
            encryptedRefreshToken: account.refresh_token
              ? await encryptSecret(account.refresh_token)
              : undefined,
            accessTokenExpiresAt: account.expires_at
              ? new Date(account.expires_at * 1000)
              : null,
            refreshTokenExpiresAt: refreshTokenExpiresIn
              ? new Date(Date.now() + refreshTokenExpiresIn * 1000)
              : null,
            tokenType: account.token_type ?? "bearer",
            scope: account.scope ?? null,
            keyVersion: 2,
            updatedAt: now,
          },
        });

      return true;
    },
    async jwt({ token, account, profile, user }) {
      if (account?.provider === "credentials" && user?.id) {
        token.localUserId = user.id;
        return token;
      }

      if (account?.provider === "google" && !token.localUserId && token.email) {
        const [localUser] = await getDatabase()
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, token.email))
          .limit(1);

        if (localUser) token.localUserId = localUser.id;
        return token;
      }

      const profileId = profile && "id" in profile ? profile.id : null;
      const githubUserId = profileId ? BigInt(profileId) : null;

      if (githubUserId) {
        const [localUser] = await getDatabase()
          .select({ id: schema.users.id, login: schema.users.login })
          .from(schema.users)
          .where(eq(schema.users.githubUserId, githubUserId))
          .limit(1);

        if (localUser) {
          token.localUserId = localUser.id;
          token.githubLogin = localUser.login;
        }
      }

      return token;
    },
    session({ session, token }) {
      if (session.user && token.localUserId) {
        session.user.id = token.localUserId;
      }
      if (session.user && token.githubLogin) {
        session.user.githubLogin = token.githubLogin;
      }
      return session;
    },
  },
});

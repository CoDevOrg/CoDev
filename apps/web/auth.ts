import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { schema } from "@codev/db";

import { resolveSignInProviderGate } from "@/lib/auth-sign-in-gate";
import { encryptSecret, hashPassword, verifyPassword } from "@/lib/crypto";
import { getDatabase } from "@/lib/database";
import { GITHUB_LINK_COOKIE, openGithubLinkState } from "@/lib/github-link";
import { mergeUserIntoCanonical } from "@/lib/user-merge";

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

async function getGithubLinkCookie() {
  try {
    return (await cookies()).get(GITHUB_LINK_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

async function clearGithubLinkCookie() {
  try {
    (await cookies()).delete(GITHUB_LINK_COOKIE);
  } catch {
    // Cookie mutation is best effort; the short-lived state cannot be reused
    // after the callback has completed successfully or been rejected.
  }
}

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
      const providerGate = resolveSignInProviderGate(account?.provider);

      // Credentials are fully validated in authorize(); do not fall through to
      // the GitHub-only gate (that used to return false → AccessDenied).
      if (providerGate === "allow-credentials") {
        return true;
      }

      if (providerGate === "handle-google") {
        const googleProfile = profile as unknown as GoogleProfile | undefined;
        const googleUserId = googleProfile?.sub ?? googleProfile?.id;
        if (
          !googleProfile?.email ||
          !googleUserId ||
          googleProfile.email_verified === false
        ) {
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
                googleUserId,
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
                googleUserId,
                name: googleProfile.name ?? null,
                email: googleProfile.email,
                avatarUrl: googleProfile.picture ?? null,
              })
              .returning({ id: schema.users.id });

        return Boolean(localUser);
      }

      if (
        providerGate !== "handle-github" ||
        !account?.access_token ||
        !profile ||
        !process.env.CREDENTIAL_ENCRYPTION_KEY
      ) {
        return false;
      }

      const githubProfile = profile as unknown as GitHubProfile;
      const now = new Date();
      const database = getDatabase();
      const githubUserId = BigInt(githubProfile.id);
      let githubLinkState: ReturnType<typeof openGithubLinkState> = null;
      const linkCookie = await getGithubLinkCookie();
      if (linkCookie) {
        githubLinkState = openGithubLinkState(linkCookie);
        if (!githubLinkState) {
          await clearGithubLinkCookie();
          return false;
        }
      }
      const [existingByGithub] = await database
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.githubUserId, githubUserId))
        .limit(1);
      let localUser;

      if (githubLinkState) {
        const [linkTarget] = await database
          .select({
            id: schema.users.id,
            githubUserId: schema.users.githubUserId,
            name: schema.users.name,
            email: schema.users.email,
            avatarUrl: schema.users.avatarUrl,
          })
          .from(schema.users)
          .where(eq(schema.users.id, githubLinkState.userId))
          .limit(1);

        if (
          !linkTarget ||
          (linkTarget.githubUserId !== null &&
            linkTarget.githubUserId !== githubUserId)
        ) {
          await clearGithubLinkCookie();
          return false;
        }

        const canonicalUserId = existingByGithub?.id ?? linkTarget.id;
        if (canonicalUserId !== linkTarget.id) {
          await mergeUserIntoCanonical(
            database,
            canonicalUserId,
            linkTarget.id,
          );
        }

        [localUser] = await database
          .update(schema.users)
          .set({
            githubUserId,
            login: githubProfile.login,
            name: linkTarget.name ?? githubProfile.name,
            email: linkTarget.email ?? githubProfile.email,
            avatarUrl: linkTarget.avatarUrl ?? githubProfile.avatar_url,
            updatedAt: now,
          })
          .where(eq(schema.users.id, canonicalUserId))
          .returning({ id: schema.users.id });
      } else {
        const [existingByEmail] = githubProfile.email
          ? await database
              .select({ id: schema.users.id })
              .from(schema.users)
              .where(eq(schema.users.email, githubProfile.email))
              .limit(1)
          : [];
        [localUser] =
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
      }

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

      if (githubLinkState) await clearGithubLinkCookie();

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

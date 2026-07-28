import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

import { schema } from "@codev/db";

import { encryptSecret } from "@/lib/crypto";
import { getDatabase } from "@/lib/database";

interface GitHubProfile {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

const githubClientId =
  process.env.AUTH_GITHUB_ID ?? "github-app-not-configured";
const githubClientSecret =
  process.env.AUTH_GITHUB_SECRET ?? "github-app-not-configured";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  providers: [
    GitHub({
      clientId: githubClientId,
      clientSecret: githubClientSecret,
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
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
      const [localUser] = await getDatabase()
        .insert(schema.users)
        .values({
          githubUserId: BigInt(githubProfile.id),
          login: githubProfile.login,
          name: githubProfile.name,
          email: githubProfile.email,
          avatarUrl: githubProfile.avatar_url,
        })
        .onConflictDoUpdate({
          target: schema.users.githubUserId,
          set: {
            login: githubProfile.login,
            name: githubProfile.name,
            email: githubProfile.email,
            avatarUrl: githubProfile.avatar_url,
            updatedAt: now,
          },
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
          encryptedAccessToken: encryptSecret(account.access_token),
          encryptedRefreshToken: account.refresh_token
            ? encryptSecret(account.refresh_token)
            : null,
          accessTokenExpiresAt: account.expires_at
            ? new Date(account.expires_at * 1000)
            : null,
          refreshTokenExpiresAt: refreshTokenExpiresIn
            ? new Date(Date.now() + refreshTokenExpiresIn * 1000)
            : null,
          tokenType: account.token_type ?? "bearer",
          scope: account.scope ?? null,
        })
        .onConflictDoUpdate({
          target: schema.githubConnections.userId,
          set: {
            encryptedAccessToken: encryptSecret(account.access_token),
            encryptedRefreshToken: account.refresh_token
              ? encryptSecret(account.refresh_token)
              : undefined,
            accessTokenExpiresAt: account.expires_at
              ? new Date(account.expires_at * 1000)
              : null,
            refreshTokenExpiresAt: refreshTokenExpiresIn
              ? new Date(Date.now() + refreshTokenExpiresIn * 1000)
              : null,
            tokenType: account.token_type ?? "bearer",
            scope: account.scope ?? null,
            updatedAt: now,
          },
        });

      return true;
    },
    async jwt({ token, profile }) {
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
        if (token.githubLogin) {
          session.user.githubLogin = token.githubLogin;
        }
      }
      return session;
    },
  },
});

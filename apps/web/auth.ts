import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { schema } from "@codev/db";

import { resolveSignInProviderGate } from "@/lib/auth/auth-sign-in-gate";
import { redeemAdminHandoffTicket } from "@/lib/auth/admin-handoff";
import { resolveCredentialsSignIn } from "@/lib/auth/credentials-auth";
import {
  applySessionRotation,
  sessionTokenIsCurrent,
  signInMethodFor,
} from "@/lib/auth/session-token";
import {
  beginTwoFactorChallenge,
  completeTwoFactorSignIn,
  twoFactorChallengePath,
  TwoFactorRequired,
} from "@/lib/auth/two-factor-challenge";
import { createUserSession, revokeUserSession } from "@/lib/auth/user-sessions";
import { encryptSecret } from "@/lib/platform/crypto";
import { getDatabase } from "@/lib/platform/database";
import {
  GITHUB_LINK_COOKIE,
  openGithubLinkState,
} from "@/lib/github/github-link";
import { resolveGithubConnection } from "@/lib/github/github";
import { getSessionCookie } from "@/lib/auth/auth-cookie";
import {
  assertCanRegister,
  clearInviteGrantCookie,
  consumeInvite,
  evaluateRegistration,
  RegistrationError,
} from "@/lib/auth/registration";
import { mergeUserIntoCanonical } from "@/lib/auth/user-merge";

/**
 * Invite gate for a brand-new account (OAuth paths). Returns `ok: false` when
 * the address is not cleared to register; on success `finalize()` retires the
 * invitation once the `users` row exists.
 */
async function gateNewAccount(
  email: string | null | undefined,
): Promise<{ ok: false } | { ok: true; finalize: () => Promise<void> }> {
  try {
    await assertCanRegister({ email });
  } catch (error) {
    if (error instanceof RegistrationError) return { ok: false };
    throw error;
  }
  return {
    ok: true,
    finalize: async () => {
      const decision = await evaluateRegistration({ email });
      if (decision.allowed && decision.via === "invite") {
        await consumeInvite(decision.requestId);
      }
      await clearInviteGrantCookie();
    },
  };
}

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

/** Where Auth.js would have sent the member, carried through the code step. */
async function oauthCallbackPath() {
  try {
    const store = await cookies();
    const value =
      store.get("__Secure-authjs.callback-url")?.value ??
      store.get("authjs.callback-url")?.value;
    if (!value) return null;
    const url = new URL(value, "https://codev.invalid");
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/** For an account with 2FA, swap a finished OAuth sign-in for the code step. */
async function oauthSecondFactor(userId: string, method: "google" | "github") {
  if (!(await beginTwoFactorChallenge(userId, method))) return true;
  return twoFactorChallengePath(await oauthCallbackPath());
}

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  cookies: {
    sessionToken: getSessionCookie(),
  },
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        intent: { label: "Intent", type: "text" },
        name: { label: "Name", type: "text" },
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const user = await resolveCredentialsSignIn(
          {
            intent: credentials?.intent,
            name: credentials?.name,
            email: credentials?.email,
            password: credentials?.password,
          },
          {
            guardRegistration: async (email) => {
              const gate = await gateNewAccount(email);
              return gate.ok;
            },
            onRegistered: async (created) => {
              const decision = await evaluateRegistration({
                email: created.email,
              });
              if (decision.allowed && decision.via === "invite") {
                await consumeInvite(decision.requestId);
              }
              await clearInviteGrantCookie();
            },
          },
        );
        // A correct password on a 2FA account starts the code step instead
        // of a session.
        if (user && (await beginTwoFactorChallenge(user.id, "password")))
          throw new TwoFactorRequired();
        return user
          ? {
              id: user.id,
              name: user.name,
              email: user.email,
              image: user.avatarUrl,
              credentialRevision: user.credentialRevision,
            }
          : null;
      },
    }),
    Credentials({
      // Redeems the one-minute ticket the public site mints for administrators.
      id: "admin-handoff",
      credentials: { ticket: { type: "text" } },
      authorize: (credentials) => redeemAdminHandoffTicket(credentials?.ticket),
    }),
    Credentials({
      // The second step after a correct password, Google, or GitHub sign-in
      // on an account with two-factor authentication. It needs the httpOnly
      // challenge cookie the first step set, so a code alone signs in nobody.
      id: "two-factor",
      credentials: { code: { type: "text" } },
      authorize: (credentials) => completeTwoFactorSignIn(credentials?.code),
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
        const [existingByGoogle] = await database
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.googleUserId, googleUserId))
          .limit(1);
        const [existingByEmail] = existingByGoogle
          ? []
          : await database
              .select({ id: schema.users.id })
              .from(schema.users)
              .where(eq(schema.users.email, googleProfile.email))
              .limit(1);
        const existingId = existingByGoogle?.id ?? existingByEmail?.id;

        if (existingId) {
          const [localUser] = await database
            .update(schema.users)
            .set({
              googleUserId,
              name: googleProfile.name ?? null,
              email: googleProfile.email,
              avatarUrl: googleProfile.picture ?? null,
              updatedAt: now,
            })
            .where(eq(schema.users.id, existingId))
            .returning({ id: schema.users.id });
          if (!localUser) return false;
          return oauthSecondFactor(localUser.id, "google");
        }

        const gate = await gateNewAccount(googleProfile.email);
        if (!gate.ok) return false;

        const [localUser] = await database
          .insert(schema.users)
          .values({
            login: `google-${googleProfile.sub ?? googleProfile.id ?? "user"}`,
            googleUserId,
            name: googleProfile.name ?? null,
            email: googleProfile.email,
            avatarUrl: googleProfile.picture ?? null,
          })
          .returning({ id: schema.users.id });

        if (!localUser) return false;
        await gate.finalize();
        return true;
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
        const existingId = existingByGithub?.id ?? existingByEmail?.id;

        if (existingId) {
          [localUser] = await database
            .update(schema.users)
            .set({
              githubUserId,
              login: githubProfile.login,
              name: githubProfile.name,
              email: githubProfile.email,
              avatarUrl: githubProfile.avatar_url,
              updatedAt: now,
            })
            .where(eq(schema.users.id, existingId))
            .returning({ id: schema.users.id });
        } else {
          const gate = await gateNewAccount(githubProfile.email);
          if (!gate.ok) return false;

          [localUser] = await database
            .insert(schema.users)
            .values({
              githubUserId,
              login: githubProfile.login,
              name: githubProfile.name,
              email: githubProfile.email,
              avatarUrl: githubProfile.avatar_url,
            })
            .returning({ id: schema.users.id });

          if (localUser) await gate.finalize();
        }
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

      // Linking GitHub to the signed-in account already passed 2FA; any
      // other GitHub sign-in to a 2FA account needs its code.
      const linkedSignedInAccount =
        githubLinkState && localUser.id === githubLinkState.userId;
      return linkedSignedInAccount
        ? true
        : oauthSecondFactor(localUser.id, "github");
    },
    async jwt({ token, account, profile, user, trigger, session }) {
      // Settings refreshes the shown display name after an edit. Only the name
      // is taken from the update payload; identity fields never are.
      if (trigger === "update") {
        const name = (session as { user?: { name?: unknown } } | undefined)
          ?.user?.name;
        if (typeof name === "string" && name.trim()) token.name = name.trim();
        // Keeps this browser signed in across its own password change.
        applySessionRotation(token, session);
      }
      if (account?.type === "credentials" && user?.id) {
        if (!user.credentialRevision) return null;
        token.localUserId = user.id;
        token.credentialRevision = user.credentialRevision;
      } else if (
        account?.provider === "google" &&
        !token.localUserId &&
        token.email
      ) {
        const [localUser] = await getDatabase()
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, token.email))
          .limit(1);

        if (localUser) token.localUserId = localUser.id;
      } else {
        const profileId = profile && "id" in profile ? profile.id : null;
        const githubUserId = profileId ? BigInt(profileId) : null;

        if (githubUserId) {
          const [localUser] = await getDatabase()
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(eq(schema.users.githubUserId, githubUserId))
            .limit(1);

          if (localUser) token.localUserId = localUser.id;
        }
      }

      // Every sign-in gets its own revocable session row (Settings →
      // Sessions); the encrypted cookie carries only the row id.
      if (account && token.localUserId) {
        token.sid = await createUserSession(
          token.localUserId,
          signInMethodFor(account, user),
        );
      }

      // Why: a GitHub account linked later via "Connect GitHub" (rather
      // than the original sign-in provider) never flows through the
      // branches above on this pass, and even a fresh GitHub sign-in
      // only sets githubLogin here once — a session's JWT otherwise
      // never revisits it. Backfilling from the same connected-accounts
      // check Settings uses keeps the header in sync shortly afterward,
      // without requiring the member to sign in again.
      const githubConnectionCheckExpired =
        !token.githubConnectionCheckedAt ||
        Date.now() - token.githubConnectionCheckedAt >= 60_000;
      if (
        token.localUserId &&
        !token.githubLogin &&
        githubConnectionCheckExpired
      ) {
        token.githubConnectionCheckedAt = Date.now();
        try {
          const github = await resolveGithubConnection(token.localUserId);
          if (github.connected && github.login) {
            token.githubLogin = github.login;
          }
        } catch {
          // GitHub is optional profile enrichment. A slow database must not
          // invalidate the member's Auth.js session and turn every workspace
          // request into a 401; retry after the short timestamp throttle.
          console.warn(
            "[auth] Skipped optional GitHub profile enrichment after a database lookup failure.",
          );
        }
      }

      const adoptRevision = Boolean(account && account.type !== "credentials");
      if (!(await sessionTokenIsCurrent(token, adoptRevision))) return null;
      return token;
    },
    session({ session, token }) {
      if (token.credentialRevision)
        session.credentialRevision = token.credentialRevision;
      if (token.sid) session.sessionId = token.sid;
      if (session.user && token.localUserId) {
        session.user.id = token.localUserId;
      }
      if (session.user && token.githubLogin) {
        session.user.githubLogin = token.githubLogin;
      }
      return session;
    },
  },
  events: {
    // Signing out ends the session server-side too, so a copied cookie
    // stops working instead of living out its 30 days.
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      if (!token?.sid || !token.localUserId) return;
      await revokeUserSession(token.localUserId, token.sid).catch(
        () => undefined,
      );
    },
  },
});

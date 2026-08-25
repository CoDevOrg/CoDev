import { getCurrentAppUser } from "@/lib/identity";
import { mintCliAccessToken } from "@/lib/cli-auth";

export const runtime = "nodejs";

/**
 * The `callbackUrl` NextAuth redirects to once a GitHub/Google sign-in
 * started from the mobile app (`GET /api/auth/signin/:provider`) completes.
 * By the time this runs, NextAuth's own `signIn` callback in `auth.ts` has
 * already resolved/linked the local user and set the session cookie — this
 * route only mints a mobile bearer token for that session and hands it back
 * to the app via its custom URL scheme.
 */
export async function GET() {
  const user = await getCurrentAppUser();
  if (!user) {
    return Response.redirect(
      "codevmobile://auth-callback?error=" +
        encodeURIComponent("Sign-in did not complete. Try again."),
    );
  }
  const { token, expiresAt } = await mintCliAccessToken(user.id, "mobile");
  return Response.redirect(
    `codevmobile://auth-callback?token=${encodeURIComponent(token)}&expiresAt=${encodeURIComponent(expiresAt.toISOString())}`,
  );
}

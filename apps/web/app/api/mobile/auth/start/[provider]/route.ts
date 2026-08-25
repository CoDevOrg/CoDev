import { apiError } from "@/lib/api";

export const runtime = "nodejs";

/**
 * `GET /api/auth/signin/:provider` alone throws NextAuth's `UnknownAction`
 * (its "GET → render the built-in sign-in page" path has nothing to render
 * once `pages.signIn` is overridden). The real provider-initiate flow needs
 * a CSRF token fetched first, then POSTed alongside `callbackUrl` — but the
 * mobile app's in-app auth sheet (`WebBrowser.openAuthSessionAsync`) can
 * only navigate to a URL, not POST a body. This route performs that
 * GET-csrf → POST-signin handshake server-side and relays every cookie NextAuth
 * set along the way (csrf token, callback-url, PKCE verifier) onto its own
 * redirect response, so the sheet's own cookie jar ends up holding exactly
 * what a real browser form-post would have produced before it navigates on
 * to the provider.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (provider !== "github" && provider !== "google") {
    return apiError(new Error("Unknown sign-in provider."), 400);
  }

  const origin = new URL(request.url).origin;

  const csrfResponse = await fetch(`${origin}/api/auth/csrf`);
  const csrfCookies = dedupeCookiesByName(csrfResponse.headers.getSetCookie());
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };

  const signInResponse = await fetch(`${origin}/api/auth/signin/${provider}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: csrfCookies.map((cookie) => cookie.split(";")[0]).join("; "),
    },
    body: new URLSearchParams({
      csrfToken,
      callbackUrl: "/api/mobile/auth/bridge",
    }),
    redirect: "manual",
  });

  const location = signInResponse.headers.get("location");
  if (!location) {
    return apiError(new Error("Could not start sign-in."), 500);
  }

  const headers = new Headers({ location });
  const outgoingCookies = dedupeCookiesByName([
    ...csrfCookies,
    ...signInResponse.headers.getSetCookie(),
  ]);
  for (const cookie of outgoingCookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { status: 302, headers });
}

/**
 * `/api/auth/csrf` (and possibly other Auth.js routes) can emit more than
 * one `Set-Cookie` for the same cookie name in a single response; only the
 * last one matches the token actually returned in the JSON body, and a
 * `Cookie:` header repeating a name is ambiguous to relay downstream. Keep
 * only the last value per name, preserving encounter order otherwise.
 */
function dedupeCookiesByName(cookies: string[]): string[] {
  const byName = new Map<string, string>();
  for (const cookie of cookies) {
    const name = cookie.split("=")[0];
    if (name) byName.set(name, cookie);
  }
  return [...byName.values()];
}

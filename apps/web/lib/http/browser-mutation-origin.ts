import { hasSameOrigin } from "./same-origin";

/** Protect cookie-authenticated APIs that do not use the shared route wrapper. */
export function hasSafeBrowserMutationOrigin(request: Request) {
  const path = new URL(request.url).pathname;
  if (
    !path.startsWith("/api/") ||
    ["GET", "HEAD", "OPTIONS"].includes(request.method)
  )
    return true;
  // Auth.js verifies its own CSRF tokens; OAuth provider callbacks originate off-site.
  if (path.startsWith("/api/auth/") && !path.startsWith("/api/auth/oauth/"))
    return true;
  if (path === "/api/billing/webhook") return true; // Stripe signature authenticates this request.
  const sessionCookie = (request.headers.get("cookie") ?? "")
    .split(";")
    .some((cookie) =>
      /^(?:__Host-)?codev\.session-token(?:\.\d+)?=/.test(cookie.trim()),
    );
  return !sessionCookie || hasSameOrigin(request);
}

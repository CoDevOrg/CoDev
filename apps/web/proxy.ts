import {
  type NextFetchEvent,
  type NextMiddleware,
  NextRequest,
  NextResponse,
} from "next/server";

import { forwardedRequest } from "@/lib/http/forwarded-request";

import { auth as nextAuth } from "@/auth";
import { clearLegacySessionCookies } from "@/lib/auth/clear-legacy-session-cookies";
import { securityHeaders } from "@/lib/platform/security-headers";
import {
  apiEdgeLimiter,
  retryAfterSeconds,
} from "@/lib/platform/upstash-rate-limit";
import {
  adminHostKeepsPath,
  isAdminHostname,
  publicAppUrl,
} from "@/lib/platform/site-hosts";

// NextAuth's `auth` is the documented middleware (`export { auth as
// middleware }`); its overloads just do not spell out the middleware call
// signature, so name it here. This is the same call production has always
// made on these paths.
const authenticationProxy = nextAuth as unknown as NextMiddleware;

function shouldAuthenticate(pathname: string): boolean {
  if (pathname === "/api/gen2/compute/reconcile") return false;
  if (pathname.startsWith("/gen2/join")) return false;
  return (
    pathname.startsWith("/gen2/") ||
    pathname === "/gen2" ||
    pathname.startsWith("/settings/") ||
    pathname === "/settings" ||
    pathname.startsWith("/api/gen2") ||
    pathname.startsWith("/api/auth/")
  );
}

function clientIdentifier(request: NextRequest) {
  const address =
    typeof WebSocketPair === "function"
      ? request.headers.get("cf-connecting-ip")
      : request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `ip:${address || "unknown"}`;
}

async function rateLimitRequest(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const edgeLimited =
    pathname === "/api/gen2/workspaces" || pathname.startsWith("/api/auth/");
  if (edgeLimited && !apiEdgeLimiter && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Rate limiting is temporarily unavailable." },
      { status: 503 },
    );
  }
  if (edgeLimited && apiEdgeLimiter) {
    let result;
    try {
      result = await apiEdgeLimiter.limit(clientIdentifier(request));
    } catch {
      return NextResponse.json(
        { error: "Rate limiting is temporarily unavailable." },
        { status: 503 },
      );
    }
    if (result.reason === "timeout") {
      return NextResponse.json(
        { error: "Rate limiting is temporarily unavailable." },
        { status: 503 },
      );
    }
    if (!result.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfterSeconds(result.reset)) },
        },
      );
    }
  }
  return null;
}

/**
 * Next.js 16 renamed middleware to proxy. This remains the edge middleware
 * boundary and must run before authentication handlers on sensitive routes.
 */
async function routeRequest(request: NextRequest, event: NextFetchEvent) {
  const pathname = request.nextUrl.pathname;
  const publicUrl = new URL(forwardedRequest(request).url);
  const adminHost = isAdminHostname(publicUrl.hostname);

  // The admin hostname is an application boundary, not just an alias. Only
  // the admin page, its sign-in flow, and framework assets are served there.
  // Workspaces and the rest of the product live on the public site.
  if (adminHost) {
    if (pathname === "/gen2/admin") {
      return NextResponse.redirect(new URL("/admin", publicUrl), 308);
    }
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/admin";
      return NextResponse.rewrite(url);
    }
    if (!adminHostKeepsPath(pathname)) {
      return NextResponse.redirect(
        publicAppUrl(pathname, request.nextUrl.search),
        307,
      );
    }
  } else if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    // Do not leave a second entry point to the internal console on the public
    // hostname. The direct server-side requireAdmin guard remains in place.
    return new NextResponse("Not Found", { status: 404 });
  }

  const limited = await rateLimitRequest(request);
  if (limited) return limited;
  return shouldAuthenticate(pathname)
    ? authenticationProxy(request, event)
    : NextResponse.next();
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const protections = securityHeaders(
    nonce,
    process.env.NODE_ENV === "production",
    new URL(forwardedRequest(request).url).origin,
  );
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set(
    "content-security-policy",
    protections.find((header) => header.key === "Content-Security-Policy")!
      .value,
  );
  const securedRequest = new NextRequest(forwardedRequest(request), {
    headers,
  });
  const response =
    (await routeRequest(securedRequest, event)) ?? NextResponse.next();
  // Forward the trusted nonce to SSR, including responses produced by Auth.js.
  const forwarded = NextResponse.next({ request: { headers } });
  forwarded.headers.forEach((value, key) => {
    if (
      key.startsWith("x-middleware-request-") ||
      key === "x-middleware-override-headers"
    ) {
      response.headers.set(key, value);
    }
  });
  protections.forEach(({ key, value }) => response.headers.set(key, value));
  clearLegacySessionCookies(forwardedRequest(request), response);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

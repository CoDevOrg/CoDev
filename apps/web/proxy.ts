import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  type NextFetchEvent,
  type NextRequest,
  NextResponse,
} from "next/server";

import { auth as nextAuth } from "@/auth";
import {
  apiEdgeLimiter,
  retryAfterSeconds,
} from "@/lib/platform/upstash-rate-limit";
import { isAdminHostname } from "@/lib/platform/site-hosts";

const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

const authenticationProxy = clerkConfigured ? clerkMiddleware() : nextAuth;
function shouldAuthenticate(pathname: string): boolean {
  return (
    pathname.startsWith("/dashboard/") ||
    pathname === "/dashboard" ||
    pathname.startsWith("/settings/") ||
    pathname === "/settings" ||
    pathname.startsWith("/workspaces/") ||
    pathname.startsWith("/api/workspace/create") ||
    pathname.startsWith("/api/workspaces") ||
    pathname.startsWith("/api/auth/")
  );
}

function clientIdentifier(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  return `ip:${forwarded?.split(",")[0]?.trim() || "unknown"}`;
}

/**
 * Next.js 16 renamed middleware to proxy. This remains the edge middleware
 * boundary and must run before authentication handlers on sensitive routes.
 */
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const pathname = request.nextUrl.pathname;
  const adminHost = isAdminHostname(request.nextUrl.hostname);

  // The admin hostname is an application boundary, not just an alias. Only
  // the admin page, its sign-in flow, and framework assets are valid there.
  if (adminHost) {
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/admin";
      return NextResponse.rewrite(url);
    }
    if (
      !pathname.startsWith("/admin") &&
      !pathname.startsWith("/sign-in") &&
      !pathname.startsWith("/api/auth/") &&
      !pathname.startsWith("/_next/") &&
      pathname !== "/favicon.ico"
    ) {
      return new NextResponse("Not Found", { status: 404 });
    }
  } else if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    // Do not leave a second entry point to the internal console on the public
    // hostname. The direct server-side requireAdmin guard remains in place.
    return new NextResponse("Not Found", { status: 404 });
  }

  const edgeLimited =
    pathname === "/api/workspace/create" ||
    pathname === "/api/workspaces" ||
    pathname.startsWith("/api/auth/");
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
  return shouldAuthenticate(pathname)
    ? authenticationProxy(request, event)
    : NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

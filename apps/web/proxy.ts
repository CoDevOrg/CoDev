import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextFetchEvent, NextRequest, NextResponse } from "next/server";

import { auth as nextAuth } from "@/auth";
import { apiEdgeLimiter, retryAfterSeconds } from "@/lib/upstash-rate-limit";

const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

const authenticationProxy = clerkConfigured ? clerkMiddleware() : nextAuth;

function clientIdentifier(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  return `ip:${forwarded?.split(",")[0]?.trim() || "unknown"}`;
}

/**
 * Next.js 16 renamed middleware to proxy. This remains the edge middleware
 * boundary and must run before authentication handlers on sensitive routes.
 */
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const edgeLimited =
    request.nextUrl.pathname === "/api/workspace/create" ||
    request.nextUrl.pathname === "/api/workspaces" ||
    request.nextUrl.pathname.startsWith("/api/auth/");
  if (edgeLimited && apiEdgeLimiter) {
    const result = await apiEdgeLimiter.limit(clientIdentifier(request));
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
  return authenticationProxy(request, event);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/settings/:path*",
    "/workspaces/:path*",
    "/api/workspace/create",
    "/api/workspaces",
    "/api/auth/:path*",
  ],
};

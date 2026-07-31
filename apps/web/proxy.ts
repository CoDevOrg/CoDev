import { clerkMiddleware } from "@clerk/nextjs/server";

import { auth as nextAuth } from "@/auth";

const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

export const proxy = clerkConfigured ? clerkMiddleware() : nextAuth;

export const config = {
  matcher: ["/dashboard/:path*", "/settings/:path*", "/workspaces/:id"],
};

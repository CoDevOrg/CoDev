import "server-only";

import { headers } from "next/headers";

export type RequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

/**
 * Client address and browser for session and security-history rows. The
 * Azure edge Worker overwrites `x-forwarded-for` with Cloudflare's client
 * address, so its first entry is trustworthy at the origin.
 */
export async function readRequestContext(): Promise<RequestContext> {
  try {
    const requestHeaders = await headers();
    const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
    const userAgent = requestHeaders.get("user-agent")?.trim();
    return {
      ipAddress: ip && ip !== "unknown" ? ip.slice(0, 64) : null,
      userAgent: userAgent ? userAgent.slice(0, 512) : null,
    };
  } catch {
    // Outside a request (tests, background work) there is nothing to record.
    return { ipAddress: null, userAgent: null };
  }
}

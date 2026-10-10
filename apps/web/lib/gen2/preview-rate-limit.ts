import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { consumeRateLimit } from "../platform/rate-limit";

const SESSION_LIMIT = 30;
/** Cloudflare's per-token limit is 1,200 requests per 5 minutes, shared. */
const ROUTE_LIMIT = 10;

/** A limiter timeout or outage denies, as for password logins. */
async function allow(subject: string, scope: string, limit: number) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return (await consumeRateLimit(subject, `gen2-${scope}`, limit, 60))
      .allowed;
  }
  const limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(limit, "1 m"),
    prefix: `codev:${scope}`,
    // An isolate-local cache must not let a burst skip the shared limit.
    ephemeralCache: false,
  });
  try {
    const result = await limiter.limit(subject);
    return result.success && result.reason !== "timeout";
  } catch {
    return false;
  }
}

/** Preview sessions per member and workspace. */
export function allowGen2PreviewSession(userId: string, workspaceId: string) {
  return allow(`${userId}:${workspaceId}`, "preview-session", SESSION_LIMIT);
}

/**
 * Sessions whose host this replica has not routed recently, per member
 * across every workspace. Each one spends the shared runtime Cloudflare
 * token that workspace starts also need.
 */
export function allowGen2PreviewRoute(userId: string) {
  return allow(userId, "preview-route", ROUTE_LIMIT);
}

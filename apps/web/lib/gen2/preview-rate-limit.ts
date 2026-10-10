import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { consumeRateLimit } from "../platform/rate-limit";

const LIMIT = 30;

/**
 * Each preview session can create a Cloudflare DNS record and spends the
 * runtime token's API budget, so sessions are limited per member and
 * workspace. A limiter timeout or outage denies, as for password logins.
 */
export async function allowGen2PreviewSession(
  userId: string,
  workspaceId: string,
) {
  const subject = `${userId}:${workspaceId}`;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return (await consumeRateLimit(subject, "gen2-preview-session", LIMIT, 60))
      .allowed;
  }
  const limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(LIMIT, "1 m"),
    prefix: "codev:preview-session",
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

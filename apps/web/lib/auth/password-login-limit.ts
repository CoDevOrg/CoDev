import "server-only";

import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { consumeRateLimit } from "../platform/rate-limit";

/** Account-wide throttling also covers server actions that bypass /api/auth. */
export async function allowPasswordLogin(email: string) {
  const subject = createHash("sha256").update(email).digest("hex");
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return (await consumeRateLimit(subject, "password-login", 10, 15 * 60))
      .allowed;
  }
  const limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(10, "15 m"),
    prefix: "codev:password-login",
    // Never let an isolate-local cache bypass the durable account limit.
    ephemeralCache: false,
  });
  try {
    const result = await limiter.limit(subject);
    return result.success && result.reason !== "timeout";
  } catch {
    return false;
  }
}

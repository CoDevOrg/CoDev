import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redisUrl =
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const hasUpstashConfiguration = Boolean(redisUrl && redisToken);

const redis = hasUpstashConfiguration
  ? new Redis({ url: redisUrl!, token: redisToken! })
  : null;

/**
 * Limits that must work across Vercel edge regions. The nullable export keeps
 * local development usable without an Upstash deployment; production callers
 * must reject requests when it is null.
 */
export const apiEdgeLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "1 m"),
      prefix: "ratelimit:edge",
    })
  : null;

export const aiAgentLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, "1 h"),
      analytics: true,
      prefix: "ratelimit:ai",
    })
  : null;

export const byokSpamLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(100, "1 m"),
      prefix: "ratelimit:byok",
    })
  : null;

export function retryAfterSeconds(reset: number) {
  return Math.max(1, Math.ceil((reset - Date.now()) / 1_000));
}

import "server-only";

import Redis from "ioredis";

let client: Redis | undefined;

function redis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  client ??= new Redis(url, {
    enableReadyCheck: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  return client;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function consumeRateLimit(
  subject: string,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const connection = redis();
  if (!connection) {
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
  const bucket = Math.floor(Date.now() / (windowSeconds * 1_000));
  const key = `codev:limit:${action}:${subject}:${bucket}`;
  const results = await connection
    .multi()
    .incr(key)
    .expire(key, windowSeconds + 1)
    .exec();
  const count = Number(results?.[0]?.[1] ?? 1);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: count <= limit ? 0 : windowSeconds,
  };
}

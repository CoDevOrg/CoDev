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
    // A missing limiter backend must never turn a production deployment into
    // an unlimited one. Local development remains usable without Redis.
    return process.env.NODE_ENV === "production"
      ? { allowed: false, remaining: 0, retryAfterSeconds: windowSeconds }
      : { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
  const bucket = Math.floor(Date.now() / (windowSeconds * 1_000));
  const key = `codev:limit:${action}:${subject}:${bucket}`;
  let results: Array<[Error | null, unknown]> | null;
  try {
    results = await connection
      .multi()
      .incr(key)
      .expire(key, windowSeconds + 1)
      .exec();
  } catch {
    // Redis outages should fail closed for the same reason as missing config.
    return { allowed: false, remaining: 0, retryAfterSeconds: windowSeconds };
  }
  if (results?.some(([error]) => error)) {
    return { allowed: false, remaining: 0, retryAfterSeconds: windowSeconds };
  }
  const count = Number(results?.[0]?.[1] ?? 1);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: count <= limit ? 0 : windowSeconds,
  };
}

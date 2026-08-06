import { afterEach, describe, expect, it, vi } from "vitest";

import { consumeRateLimit } from "./rate-limit";

describe("consumeRateLimit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed in production when Redis is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REDIS_URL", "");

    await expect(consumeRateLimit("user-1", "feedback", 5, 60)).resolves.toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });
  });

  it("keeps local development usable without Redis", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REDIS_URL", "");

    await expect(consumeRateLimit("user-1", "feedback", 5, 60)).resolves.toEqual({
      allowed: true,
      remaining: 5,
      retryAfterSeconds: 0,
    });
  });
});

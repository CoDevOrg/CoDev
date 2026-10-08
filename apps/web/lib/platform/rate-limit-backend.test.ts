import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("ioredis", () => ({
  default: class {
    multi() {
      return {
        incr() {
          return this;
        },
        expire() {
          return this;
        },
        exec: mocks.exec,
      };
    }
  },
}));
import { consumeRateLimit } from "./rate-limit";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("REDIS_URL", "redis://localhost:6379");
});
afterEach(() => vi.unstubAllEnvs());
it.each([
  null,
  [],
  [[null, 1]],
  [
    [null, "not-a-count"],
    [null, 1],
  ],
  [
    [null, 0],
    [null, 1],
  ],
])(
  "fails closed on an incomplete or invalid Redis transaction %j",
  async (result) => {
    mocks.exec.mockResolvedValue(result);
    expect(
      await consumeRateLimit("account", "password-login", 10, 900),
    ).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 900 });
  },
);
it("accepts a complete transaction and rejects an exhausted bucket", async () => {
  mocks.exec.mockResolvedValue([
    [null, 1],
    [null, 1],
  ]);
  expect(
    (await consumeRateLimit("account", "password-login", 10, 900)).allowed,
  ).toBe(true);
  mocks.exec.mockResolvedValue([
    [null, 11],
    [null, 1],
  ]);
  expect(
    (await consumeRateLimit("account", "password-login", 10, 900)).allowed,
  ).toBe(false);
});

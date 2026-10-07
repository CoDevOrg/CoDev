import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ limit: vi.fn(), consume: vi.fn() }));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow = vi.fn();
    limit = mocks.limit;
  },
}));
vi.mock("@upstash/redis", () => ({ Redis: class {} }));
vi.mock("../platform/rate-limit", () => ({ consumeRateLimit: mocks.consume }));
import { allowPasswordLogin } from "./password-login-limit";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("KV_REST_API_URL", "https://redis.example");
  vi.stubEnv("KV_REST_API_TOKEN", "token");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  mocks.limit.mockResolvedValue({ success: true });
});
afterEach(() => vi.unstubAllEnvs());
it("uses durable account buckets without storing email addresses", async () => {
  expect(await allowPasswordLogin("ada@example.com")).toBe(true);
  expect(mocks.limit.mock.calls[0]![0]).toMatch(/^[0-9a-f]{64}$/);
  mocks.limit.mockResolvedValue({ success: false });
  expect(await allowPasswordLogin("ada@example.com")).toBe(false);
});
it("fails closed when the limiter fails", async () => {
  mocks.limit.mockRejectedValue(new Error("unavailable"));
  expect(await allowPasswordLogin("ada@example.com")).toBe(false);
});
it("rejects Upstash's fail-open timeout result", async () => {
  mocks.limit.mockResolvedValue({ success: true, reason: "timeout" });
  expect(await allowPasswordLogin("ada@example.com")).toBe(false);
});
it("uses the existing TCP limiter when REST credentials are unavailable", async () => {
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("KV_REST_API_TOKEN", "");
  mocks.consume.mockResolvedValue({ allowed: false });
  expect(await allowPasswordLogin("ada@example.com")).toBe(false);
  expect(mocks.consume).toHaveBeenCalledWith(
    expect.stringMatching(/^[0-9a-f]{64}$/),
    "password-login",
    10,
    900,
  );
});

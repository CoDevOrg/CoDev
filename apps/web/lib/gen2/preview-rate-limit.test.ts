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

import { allowGen2PreviewSession } from "./preview-rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("KV_REST_API_URL", "https://redis.example");
  vi.stubEnv("KV_REST_API_TOKEN", "token");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  mocks.limit.mockResolvedValue({ success: true });
});
afterEach(() => vi.unstubAllEnvs());

it("limits each member per workspace", async () => {
  expect(await allowGen2PreviewSession("user-1", "workspace-1")).toBe(true);
  expect(mocks.limit).toHaveBeenCalledWith("user-1:workspace-1");
  mocks.limit.mockResolvedValue({ success: false });
  expect(await allowGen2PreviewSession("user-1", "workspace-1")).toBe(false);
});

it("denies on Upstash's fail-open timeout and on limiter errors", async () => {
  mocks.limit.mockResolvedValueOnce({ success: true, reason: "timeout" });
  expect(await allowGen2PreviewSession("user-1", "workspace-1")).toBe(false);
  mocks.limit.mockRejectedValueOnce(new Error("unavailable"));
  expect(await allowGen2PreviewSession("user-1", "workspace-1")).toBe(false);
});

it("falls back to the TCP limiter without REST credentials", async () => {
  vi.stubEnv("KV_REST_API_URL", "");
  mocks.consume.mockResolvedValue({ allowed: true });
  expect(await allowGen2PreviewSession("user-1", "workspace-1")).toBe(true);
  expect(mocks.consume).toHaveBeenCalledWith(
    "user-1:workspace-1",
    "gen2-preview-session",
    30,
    60,
  );
});

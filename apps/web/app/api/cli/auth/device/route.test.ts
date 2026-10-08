import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ limit: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/platform/rate-limit", () => ({ consumeRateLimit: mocks.limit }));
vi.mock("@/lib/auth/cli-auth", () => ({
  createCliDeviceAuthorization: mocks.create,
}));
import { POST } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.limit.mockResolvedValue({ allowed: true });
  mocks.create.mockResolvedValue({
    deviceCode: "device",
    userCode: "code",
    expiresAt: new Date(),
  });
});
it.each(["forged-a", "forged-b"])(
  "ignores spoofed Vercel forwarding identity %s",
  async (forged) => {
    const response = await POST(
      new Request("https://trycodev.com/api/cli/auth/device", {
        method: "POST",
        headers: {
          "x-forwarded-for": "192.0.2.1",
          "x-vercel-forwarded-for": forged,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.limit).toHaveBeenCalledWith(
      "192.0.2.1",
      "cli-device-auth",
      20,
      3600,
    );
  },
);
it("does not issue a device authorization when throttled", async () => {
  mocks.limit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
  const response = await POST(
    new Request("https://trycodev.com/api/cli/auth/device", { method: "POST" }),
  );
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("60");
  expect(mocks.create).not.toHaveBeenCalled();
});

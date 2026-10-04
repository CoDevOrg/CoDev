import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("@/lib/http/api", () => ({ getApiUser: async () => ({ id: "u" }) }));
vi.mock("@/lib/admin/page-views", () => ({
  hashCallerAddress: () => "hash",
  recordPageView: mocks.record,
}));
import { POST } from "./route";
const request = (headers: Record<string, string> = {}) =>
  new Request("https://codev.test/api/track/visit", {
    method: "POST",
    headers,
    body: JSON.stringify({
      path: "/sign-in?token=secret#key",
      referrer: "https://example.com/private?code=secret",
    }),
  });
describe("analytics ingestion", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([
    {},
    { cookie: "codev_analytics=denied" },
    { cookie: "codev_analytics=allowed", "sec-gpc": "1" },
    { cookie: "codev_analytics=allowed", dnt: "1" },
  ])("does not store visits without effective consent", async (headers) => {
    expect((await POST(request(headers))).status).toBe(204);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("strips sensitive URL portions on the server as well", async () => {
    await POST(request({ cookie: "codev_analytics=allowed" }));
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/sign-in",
        referrer: "https://example.com",
      }),
    );
  });
});

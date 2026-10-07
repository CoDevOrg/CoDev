import { afterEach, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";
import { proxy } from "../../proxy";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/platform/upstash-rate-limit", () => ({ apiEdgeLimiter: null }));
const secret = "a".repeat(64);
const event = {} as NextFetchEvent;
afterEach(() => vi.unstubAllEnvs());
function request(
  path: string,
  host = "admins.trycodev.com",
  credential = secret,
) {
  return new NextRequest(`http://0.0.0.0:3000${path}`, {
    headers: {
      "x-codev-origin-secret": credential,
      "x-codev-public-host": host,
    },
  });
}
it("allows the admin console through the authenticated Azure public hostname", async () => {
  vi.stubEnv("AZURE_WEB_ORIGIN_SECRET", secret);
  const response = await proxy(request("/admin"), event);
  expect(response?.headers.get("x-middleware-next")).toBe("1");
});
it("redirects the legacy admin link before workspace routing", async () => {
  vi.stubEnv("AZURE_WEB_ORIGIN_SECRET", secret);
  const response = await proxy(request("/gen2/admin"), event);
  expect(response?.status).toBe(308);
  expect(response?.headers.get("location")).toBe(
    "https://admins.trycodev.com/admin",
  );
});
it.each([
  ["www.trycodev.com", secret],
  ["admins.trycodev.com", "forged"],
])(
  "keeps the admin boundary closed for %s with an untrusted or public origin",
  async (host, credential) => {
    vi.stubEnv("AZURE_WEB_ORIGIN_SECRET", secret);
    const response = await proxy(request("/admin", host, credential), event);
    expect(response?.status).toBe(404);
  },
);

it("uses the authenticated public origin for CSP and legacy cookie retirement", async () => {
  vi.stubEnv("AZURE_WEB_ORIGIN_SECRET", secret);
  const incoming = request("/admin");
  incoming.headers.set("cookie", "__Secure-codev.session-token=old");
  const response = await proxy(incoming, event);
  expect(response.headers.get("content-security-policy")).toContain(
    "wss://admins.trycodev.com",
  );
  expect(response.headers.get("content-security-policy")).not.toContain(
    "0.0.0.0",
  );
  expect(response.headers.getSetCookie()).toContain(
    "__Secure-codev.session-token=; Domain=trycodev.com; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
  );
});

import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock("@/auth", () => ({ handlers: mocks }));
import { GET, POST } from "@/app/api/auth/[...nextauth]/route";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it.each(["GET", "POST"] as const)(
  "retains the authenticated admin callback origin for %s",
  async (method) => {
    vi.stubEnv("AZURE_WEB_ORIGIN_SECRET", "trusted-edge");
    const request = new NextRequest(
      "http://0.0.0.0:3000/api/auth/callback/github",
      {
        method,
        headers: {
          "x-codev-origin-secret": "trusted-edge",
          "x-codev-public-host": "admins.trycodev.com",
          cookie: "state=private",
        },
        ...(method === "POST" ? { body: "csrfToken=test" } : {}),
      },
    );
    (method === "GET" ? GET : POST)(request);
    const forwarded = mocks[method].mock.calls[0]![0] as NextRequest;
    expect(forwarded.url).toBe(
      "https://admins.trycodev.com/api/auth/callback/github",
    );
    expect(forwarded.headers.get("cookie")).toBe("state=private");
    if (method === "POST")
      expect(await forwarded.text()).toBe("csrfToken=test");
  },
);

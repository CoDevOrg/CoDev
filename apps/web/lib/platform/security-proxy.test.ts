import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("./upstash-rate-limit", () => ({
  apiEdgeLimiter: { limit: mocks.limit },
  retryAfterSeconds: () => 60,
}));
import { proxy } from "@/proxy";
const event = {} as NextFetchEvent;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  mocks.limit.mockResolvedValue({ success: true });
  mocks.auth.mockImplementation(() => NextResponse.next());
});
afterEach(() => vi.unstubAllEnvs());
it("overwrites untrusted nonces and forwards the same nonce to SSR and browser CSP", async () => {
  const response = await proxy(
    new NextRequest("https://www.trycodev.com/sign-in", {
      headers: {
        "x-nonce": "attacker",
        "content-security-policy": "script-src 'unsafe-inline'",
      },
    }),
    event,
  );
  const nonce = response.headers.get("x-middleware-request-x-nonce");
  expect(nonce).toBeTruthy();
  expect(nonce).not.toBe("attacker");
  expect(response.headers.get("content-security-policy")).toContain(
    `'nonce-${nonce}'`,
  );
  expect(
    response.headers.get("x-middleware-request-content-security-policy"),
  ).toBe(response.headers.get("content-security-policy"));
  expect(response.headers.get("content-security-policy")).not.toContain(
    "'unsafe-eval'",
  );
  expect(response.headers.get("strict-transport-security")).toBe(
    "max-age=31536000",
  );
  const other = await proxy(
    new NextRequest("https://www.trycodev.com/sign-in"),
    event,
  );
  expect(other.headers.get("x-middleware-request-x-nonce")).not.toBe(nonce);
});
it("preserves Auth.js cookies and sends its response through the same security boundary", async () => {
  mocks.auth.mockImplementation(
    () =>
      new Response(null, {
        headers: {
          "x-middleware-next": "1",
          "set-cookie": "new-session=value; Secure; HttpOnly",
        },
      }),
  );
  const response = await proxy(
    new NextRequest("https://www.trycodev.com/gen2"),
    event,
  );
  expect(mocks.auth).toHaveBeenCalledOnce();
  expect(response.headers.getSetCookie()).toContain(
    "new-session=value; Secure; HttpOnly",
  );
  expect(response.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'",
  );
});
it("fails closed on Upstash's success=true timeout result", async () => {
  mocks.limit.mockResolvedValue({ success: true, reason: "timeout" });
  const response = await proxy(
    new NextRequest("https://www.trycodev.com/api/auth/session"),
    event,
  );
  expect(response.status).toBe(503);
  expect(mocks.auth).not.toHaveBeenCalled();
});
it("retains rate-limit responses and protects admin boundary errors", async () => {
  mocks.limit.mockResolvedValue({ success: false, reset: Date.now() + 60000 });
  expect(
    (
      await proxy(
        new NextRequest("https://www.trycodev.com/api/auth/session"),
        event,
      )
    ).status,
  ).toBe(429);
  const response = await proxy(
    new NextRequest("https://www.trycodev.com/admin"),
    event,
  );
  expect(response.status).toBe(404);
  expect(response.headers.get("x-frame-options")).toBe("DENY");
});

it("keeps POST bodies available to the route after middleware", async () => {
  vi.stubEnv("AZURE_WEB_ORIGIN_SECRET", "trusted-edge");
  const request = new NextRequest("http://0.0.0.0:3000/api/gen2/workspaces", {
    method: "POST",
    headers: {
      "x-codev-origin-secret": "trusted-edge",
      "x-codev-public-host": "www.trycodev.com",
    },
    body: "csrfToken=test",
  });
  await proxy(request, event);
  expect(await request.text()).toBe("csrfToken=test");
  const secured = mocks.auth.mock.calls[0]![0] as NextRequest;
  expect(secured.url).toBe("https://www.trycodev.com/api/gen2/workspaces");
});

it("leaves Auth.js CSRF and OAuth cookies to the auth route handler", async () => {
  const response = await proxy(
    new NextRequest("https://www.trycodev.com/api/auth/csrf"),
    event,
  );
  expect(mocks.limit).toHaveBeenCalledOnce();
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(response.headers.getSetCookie()).toEqual([]);
});

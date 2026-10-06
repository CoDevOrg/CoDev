import { afterEach, expect, it, vi } from "vitest";
import { forwardedRequest } from "./forwarded-request";

const secret = "a".repeat(64);
afterEach(() => vi.unstubAllEnvs());

it.each(["trycodev.com", "www.trycodev.com", "admins.trycodev.com"])(
  "preserves the public origin, body, and auth headers for %s",
  async (host) => {
    vi.stubEnv("AZURE_WEB_ORIGIN_SECRET", secret);
    const request = new Request("http://0.0.0.0:3000/api/test?after=42", {
      method: "POST",
      headers: {
        "x-codev-origin-secret": secret,
        "x-codev-public-host": host,
        origin: `https://${host}`,
        cookie: "session=test",
        "x-codev-node-websocket-id": "single-use-id",
      },
      body: JSON.stringify({ message: "saved" }),
    });
    const forwarded = forwardedRequest(request);
    expect(forwarded.url).toBe(`https://${host}/api/test?after=42`);
    expect(forwarded.headers.get("origin")).toBe(new URL(forwarded.url).origin);
    expect(forwarded.headers.get("cookie")).toBe("session=test");
    expect(forwarded.headers.get("x-codev-node-websocket-id")).toBe(
      "single-use-id",
    );
    expect(await forwarded.json()).toEqual({ message: "saved" });
  },
);

it("ignores forged proxy headers and unapproved hosts", () => {
  vi.stubEnv("AZURE_WEB_ORIGIN_SECRET", secret);
  for (const [credential, host] of [
    ["forged", "www.trycodev.com"],
    [secret, "evil.test"],
  ]) {
    const request = new Request("https://existing.test/api/test", {
      headers: {
        "x-codev-origin-secret": credential,
        "x-codev-public-host": host,
      },
    });
    expect(forwardedRequest(request)).toBe(request);
  }
});

it("does not rewrite other hosts or alter an attacker's Origin", () => {
  const request = new Request("https://existing.test/api/test", {
    headers: {
      "x-codev-origin-secret": secret,
      "x-codev-public-host": "www.trycodev.com",
      origin: "https://evil.test",
    },
  });
  expect(forwardedRequest(request)).toBe(request);
  vi.stubEnv("AZURE_WEB_ORIGIN_SECRET", secret);
  const forwarded = forwardedRequest(request);
  expect(forwarded.headers.get("origin")).not.toBe(
    new URL(forwarded.url).origin,
  );
});

import { expect, it } from "vitest";
import { securityHeaders } from "./security-headers";
const values = (nonce?: string, production = true) =>
  Object.fromEntries(
    securityHeaders(nonce, production).map(({ key, value }) => [key, value]),
  );
it("requires the current nonce and blocks inline handlers, objects, and framing", () => {
  const headers = values("random-nonce");
  const policy = headers["Content-Security-Policy"];
  expect(policy).toContain(
    "script-src 'self' 'nonce-random-nonce' 'strict-dynamic';",
  );
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy).toContain("script-src-attr 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000");
});
it("keeps HTTP development and framework hot reload usable", () => {
  const headers = values("dev-nonce", false);
  expect(headers["Strict-Transport-Security"]).toBeUndefined();
  expect(headers["Content-Security-Policy"]).toContain("'unsafe-eval'");
  expect(headers["Content-Security-Policy"]).toContain("http://127.0.0.1:*");
  expect(headers["Content-Security-Policy"]).not.toContain(
    "upgrade-insecure-requests",
  );
});

it("allows canonical public redirects from the admin host without sharing runtime origins", () => {
  const policy = securityHeaders(
    "test-nonce",
    true,
    "https://admins.trycodev.com",
  ).find(({ key }) => key === "Content-Security-Policy")!.value;
  expect(policy).toContain(
    "connect-src 'self' https://www.trycodev.com wss://admins.trycodev.com",
  );
  expect(policy).toContain("form-action 'self' https://www.trycodev.com");
  expect(policy).not.toContain("https://*.trycodev.com");
});

const policyOf = (production: boolean, previewZone: string | null = null) =>
  securityHeaders("nonce", production, undefined, previewZone).find(
    ({ key }) => key === "Content-Security-Policy",
  )!.value;

it("frames only the configured preview zone in production, still unframeable itself", () => {
  expect(policyOf(true)).not.toContain("frame-src");
  const policy = policyOf(true, "codev-preview.dev");
  expect(policy).toContain("frame-src 'self' https://*.codev-preview.dev;");
  expect(policy).not.toContain("http://localhost:*;");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(values("nonce")["X-Frame-Options"]).toBe("DENY");
});

it("frames local dev servers in development", () => {
  expect(policyOf(false)).toContain(
    "frame-src 'self' http://localhost:* http://127.0.0.1:*;",
  );
  expect(policyOf(false, "codev-preview.dev")).toContain(
    "frame-src 'self' https://*.codev-preview.dev http://localhost:*",
  );
});

it("allows the app's own microphone for dictation and nothing else", () => {
  expect(values()["Permissions-Policy"]).toBe(
    "camera=(), microphone=(self), geolocation=()",
  );
});

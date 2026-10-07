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

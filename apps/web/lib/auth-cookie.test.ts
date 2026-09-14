import { describe, expect, it } from "vitest";

import { getSharedAuthCookieDomain } from "./auth-cookie";

describe("getSharedAuthCookieDomain", () => {
  it("shares the session cookie across production subdomains", () => {
    expect(getSharedAuthCookieDomain("production")).toBe(".trycodev.com");
  });

  it("does not scope local or preview cookies to the production domain", () => {
    expect(getSharedAuthCookieDomain("preview")).toBeUndefined();
    expect(getSharedAuthCookieDomain(undefined)).toBeUndefined();
  });
});

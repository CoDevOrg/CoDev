import { describe, expect, it } from "vitest";

import {
  getSharedAuthCookieDomain,
  getSharedAuthCookieName,
} from "./auth-cookie";

describe("getSharedAuthCookieDomain", () => {
  it("shares the session cookie across production subdomains", () => {
    expect(getSharedAuthCookieDomain("production")).toBe(".trycodev.com");
    expect(getSharedAuthCookieName("production")).toBe(
      "__Secure-codev.session-token",
    );
  });

  it("does not scope local or preview cookies to the production domain", () => {
    expect(getSharedAuthCookieDomain("preview")).toBeUndefined();
    expect(getSharedAuthCookieName("preview")).toBeUndefined();
    expect(getSharedAuthCookieDomain(undefined)).toBeUndefined();
    expect(getSharedAuthCookieName(undefined)).toBeUndefined();
  });
});

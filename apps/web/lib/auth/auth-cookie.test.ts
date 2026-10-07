import { describe, expect, it } from "vitest";
import { getSessionCookie } from "./auth-cookie";

describe("session cookie isolation", () => {
  it("uses a secure host-only cookie in every production build, including previews", () => {
    const cookie = getSessionCookie(true);
    expect(cookie.name).toBe("__Host-codev.session-token");
    expect(cookie.options).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
    });
    expect(cookie.options).not.toHaveProperty("domain");
  });
  it("supports HTTP localhost without sharing cookies with subdomains", () => {
    expect(getSessionCookie(false)).toEqual({
      name: "codev.session-token",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: false },
    });
  });
});

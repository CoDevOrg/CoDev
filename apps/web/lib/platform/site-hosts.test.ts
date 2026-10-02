import { describe, expect, it } from "vitest";

import { adminHostKeepsPath, publicAppHref, publicAppUrl } from "./site-hosts";

describe("admin host links", () => {
  it("keeps the admin console on the admin hostname", () => {
    expect(adminHostKeepsPath("/admin")).toBe(true);
    expect(adminHostKeepsPath("/sign-in")).toBe(true);
    expect(adminHostKeepsPath("/api/auth/session")).toBe(true);
  });

  it("sends workspaces back to the public site", () => {
    expect(adminHostKeepsPath("/gen2")).toBe(false);
    expect(publicAppUrl("/gen2", "?tab=owned")).toBe(
      "https://www.trycodev.com/gen2?tab=owned",
    );
    expect(publicAppHref("/gen2", true)).toBe("https://www.trycodev.com/gen2");
    expect(publicAppHref("/gen2", false)).toBe("/gen2");
  });
});

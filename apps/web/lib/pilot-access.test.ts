import { describe, expect, it } from "vitest";

import { isPilotAdminLogin, parsePilotAdminLogins } from "./pilot-access";

describe("pilot administrator access", () => {
  it("normalizes a comma-separated GitHub login allowlist", () => {
    expect([
      ...parsePilotAdminLogins(" Yousef20920, CODEV-operator ,,"),
    ]).toEqual(["yousef20920", "codev-operator"]);
  });

  it("matches GitHub logins case-insensitively", () => {
    expect(isPilotAdminLogin("YOUSEF20920", "yousef20920")).toBe(true);
    expect(isPilotAdminLogin("another-user", "yousef20920")).toBe(false);
    expect(isPilotAdminLogin(undefined, "yousef20920")).toBe(false);
  });
});

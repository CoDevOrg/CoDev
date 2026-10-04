import { describe, expect, it } from "vitest";

import {
  evaluateRegistration,
  isEmailAllowlisted,
  parseSignupAllowlist,
} from "./registration";

describe("signup allowlist", () => {
  it("splits on commas and whitespace and lower-cases", () => {
    expect(
      parseSignupAllowlist({
        SIGNUP_ALLOWLIST:
          "Founder@codev.dev, second@codev.dev\nthird@codev.dev",
      }),
    ).toEqual(["founder@codev.dev", "second@codev.dev", "third@codev.dev"]);
  });

  it("is empty when unset", () => {
    expect(parseSignupAllowlist({})).toEqual([]);
  });

  it("does not honor legacy allowlists", async () => {
    const env = { SIGNUP_ALLOWLIST: "founder@codev.dev" };
    expect(isEmailAllowlisted("FOUNDER@codev.dev", env)).toBe(false);
    expect(isEmailAllowlisted("someone@else.com", env)).toBe(false);
    expect(isEmailAllowlisted(null, env)).toBe(false);
    expect(isEmailAllowlisted(undefined, env)).toBe(false);
  });

  it("keeps registration closed even when an allowlist is configured", async () => {
    await expect(
      evaluateRegistration({ email: "founder@codev.dev" }),
    ).resolves.toEqual({
      allowed: false,
      code: "invite_required",
    });
  });
});

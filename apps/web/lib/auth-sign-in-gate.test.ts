import { describe, expect, it } from "vitest";

import { resolveSignInProviderGate } from "./auth-sign-in-gate";

describe("resolveSignInProviderGate", () => {
  it("allows credentials so email/password sign-in is not AccessDenied", () => {
    expect(resolveSignInProviderGate("credentials")).toBe("allow-credentials");
  });

  it("routes google and github to their handlers", () => {
    expect(resolveSignInProviderGate("google")).toBe("handle-google");
    expect(resolveSignInProviderGate("github")).toBe("handle-github");
  });

  it("denies unknown providers", () => {
    expect(resolveSignInProviderGate(undefined)).toBe("deny");
    expect(resolveSignInProviderGate("facebook")).toBe("deny");
  });
});

import { describe, expect, it } from "vitest";

import { deriveClerkLogin } from "./identity-profile";

describe("Clerk profile login derivation", () => {
  it("prefers the real GitHub handle from a linked GitHub account", () => {
    expect(
      deriveClerkLogin({
        id: "user_clerk_123456",
        username: "display-name",
        primaryEmailAddress: { emailAddress: "display@example.com" },
        externalAccounts: [{ provider: "oauth_github", username: "octocat" }],
      }),
    ).toBe("octocat");
  });

  it("falls back to the Clerk username, email prefix, and stable id", () => {
    expect(
      deriveClerkLogin({ id: "user_123456789012", username: "alex" }),
    ).toBe("alex");
    expect(
      deriveClerkLogin({
        id: "user_123456789012",
        primaryEmailAddress: { emailAddress: "alex@example.com" },
      }),
    ).toBe("alex");
    expect(deriveClerkLogin({ id: "user_123456789012" })).toBe(
      "user-123456789012",
    );
  });
});

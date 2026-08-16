import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./hosted-codex-subscription-flag", () => ({
  HOSTED_CODEX_SUBSCRIPTION_LAUNCH_APPROVED: true,
  isHostedCodexSubscriptionEnabled: () => true,
}));

import {
  FORBIDDEN_CODEX_PUBLIC_CLI_CLIENT_ID,
  buildHostedCodexAuthorizationUrl,
  createHostedCodexPkceVerifier,
  getHostedCodexApprovedConfig,
  hostedCodexPkceChallenge,
  redactHostedCodexAccountLabel,
  safeHostedCodexReturnTo,
  setHostedCodexApprovedConfigForTests,
} from "./hosted-codex-subscription";

const approved = {
  clientId: "codev-hosted-approved-client",
  authorizeUrl: "https://auth.example.openai.invalid/authorize",
  tokenUrl: "https://auth.example.openai.invalid/token",
  redirectUri: "https://app.codev.dev/api/auth/hosted-codex/callback",
  issuer: "https://auth.example.openai.invalid",
  scopes: "openid profile",
};

describe("hosted Codex approved configuration", () => {
  afterEach(() => {
    setHostedCodexApprovedConfigForTests(undefined);
    vi.unstubAllEnvs();
  });

  it("never falls back to the Codex public CLI client", () => {
    setHostedCodexApprovedConfigForTests(undefined);
    vi.stubEnv(
      "HOSTED_CODEX_APPROVED_CLIENT_ID",
      FORBIDDEN_CODEX_PUBLIC_CLI_CLIENT_ID,
    );
    vi.stubEnv(
      "HOSTED_CODEX_APPROVED_AUTHORIZE_URL",
      "https://auth.openai.com/oauth/authorize",
    );
    vi.stubEnv(
      "HOSTED_CODEX_APPROVED_TOKEN_URL",
      "https://auth.openai.com/oauth/token",
    );
    vi.stubEnv(
      "HOSTED_CODEX_APPROVED_REDIRECT_URI",
      "https://app.codev.dev/api/auth/hosted-codex/callback",
    );
    vi.stubEnv("HOSTED_CODEX_APPROVED_ISSUER", "https://auth.openai.com");
    vi.stubEnv("HOSTED_CODEX_APPROVED_SCOPE", "openid");
    expect(() => getHostedCodexApprovedConfig()).toThrow(/public CLI client/i);
  });

  it("builds a PKCE authorization URL from the approved config only", () => {
    setHostedCodexApprovedConfigForTests(approved);
    const verifier = createHostedCodexPkceVerifier();
    const url = buildHostedCodexAuthorizationUrl({
      config: approved,
      state: "state-1",
      codeChallenge: hostedCodexPkceChallenge(verifier),
      nonce: "nonce-1",
      scopeType: "USER",
    });
    expect(url.searchParams.get("client_id")).toBe(approved.clientId);
    expect(url.searchParams.get("client_id")).not.toBe(
      FORBIDDEN_CODEX_PUBLIC_CLI_CLIENT_ID,
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("codex_cli_simplified_flow")).toBeNull();
    expect(url.toString()).not.toContain("deviceauth");
  });

  it("rejects open redirects and redacts account labels", () => {
    expect(safeHostedCodexReturnTo("//evil.example", "/settings")).toBe(
      "/settings",
    );
    expect(safeHostedCodexReturnTo("https://evil.example", "/settings")).toBe(
      "/settings",
    );
    expect(safeHostedCodexReturnTo("/settings/org/agents", "/settings")).toBe(
      "/settings/org/agents",
    );
    expect(redactHostedCodexAccountLabel("jordan@example.com")).toBe(
      "j…@example.com",
    );
    expect(redactHostedCodexAccountLabel("acct-123456")).toBe("ending 3456");
  });
});

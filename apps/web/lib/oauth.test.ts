import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAuthorizationUrl,
  createOAuthState,
  exchangeOAuthCode,
  getOAuthConfiguration,
  getOAuthConfigurationStatus,
  openOAuthState,
  OAuthConfigurationError,
  pkceChallenge,
  sealOAuthState,
} from "./oauth";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("provider OAuth", () => {
  it("reports missing provider client configuration without exposing values", () => {
    vi.stubEnv("CLAUDE_OAUTH_CLIENT_ID", "");

    expect(getOAuthConfigurationStatus("claude")).toEqual({
      configured: false,
      missing: ["CLAUDE_OAUTH_CLIENT_ID"],
    });
    expect(() =>
      getOAuthConfiguration("claude", "https://app.example.com"),
    ).toThrowError(OAuthConfigurationError);
  });

  it("seals and validates the PKCE state payload", () => {
    vi.stubEnv("AUTH_SECRET", "a".repeat(40));
    const state = createOAuthState({
      userId: "user-1",
      scopeType: "USER",
      scopeId: "user-1",
      returnTo: "/settings",
    });

    expect(openOAuthState(sealOAuthState(state))).toEqual(state);
    expect(() => openOAuthState(`${sealOAuthState(state)}x`)).toThrow(
      "Invalid OAuth state.",
    );
  });

  it("builds Claude Code and Codex authorization requests with S256 PKCE", () => {
    vi.stubEnv("CLAUDE_OAUTH_CLIENT_ID", "claude-client");
    vi.stubEnv("CODEX_OAUTH_CLIENT_ID", "codex-client");
    const state = createOAuthState({
      userId: "user-1",
      scopeType: "USER",
      scopeId: "user-1",
      returnTo: "/settings",
    });

    const claude = buildAuthorizationUrl(
      getOAuthConfiguration("claude", "https://app.example.com"),
      state,
    );
    const codex = buildAuthorizationUrl(
      getOAuthConfiguration("codex", "https://app.example.com"),
      state,
    );

    expect(claude.searchParams.get("code_challenge")).toBe(
      pkceChallenge(state.codeVerifier),
    );
    expect(claude.searchParams.get("code_challenge_method")).toBe("S256");
    expect(claude.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/auth/oauth/claude/callback",
    );
    expect(codex.searchParams.get("codex_cli_simplified_flow")).toBe("true");
    expect(codex.searchParams.get("client_id")).toBe("codex-client");
  });

  it("exchanges a code without returning provider secrets to callers", async () => {
    vi.stubEnv("CODEX_OAUTH_CLIENT_ID", "codex-client");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        }),
      })),
    );

    const configuration = getOAuthConfiguration(
      "codex",
      "https://app.example.com",
    );
    const tokens = await exchangeOAuthCode(
      configuration,
      "authorization-code",
      "code-verifier",
    );

    expect(tokens.accessToken).toBe("access-token");
    expect(tokens.refreshToken).toBe("refresh-token");
    expect(tokens.expiresAt).toBeInstanceOf(Date);
    expect(tokens).not.toHaveProperty("clientSecret");
  });
});

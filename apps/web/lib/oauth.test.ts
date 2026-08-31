import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAuthorizationUrl,
  CLAUDE_MANUAL_REDIRECT_URI,
  CODEX_DEVICE_REDIRECT_URI,
  createOAuthState,
  DEFAULT_CLAUDE_OAUTH_CLIENT_ID,
  DEFAULT_CODEX_OAUTH_CLIENT_ID,
  exchangeOAuthCode,
  getOAuthConfiguration,
  getOAuthConfigurationStatus,
  getOAuthFlowMode,
  openOAuthState,
  parseManualAuthorizationCode,
  pkceChallenge,
  pollCursorLogin,
  sealOAuthState,
  startCursorLogin,
} from "./oauth";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("provider OAuth", () => {
  it("defaults to public CLI clients when env vars are unset", () => {
    vi.stubEnv("CLAUDE_OAUTH_CLIENT_ID", "");
    vi.stubEnv("CODEX_OAUTH_CLIENT_ID", "");

    expect(getOAuthConfigurationStatus("claude")).toMatchObject({
      configured: true,
      flowMode: "manual_code",
    });
    expect(getOAuthConfigurationStatus("codex")).toMatchObject({
      configured: true,
      flowMode: "device_code",
    });
    expect(
      getOAuthConfiguration("claude", "https://app.example.com").clientId,
    ).toBe(DEFAULT_CLAUDE_OAUTH_CLIENT_ID);
    expect(
      getOAuthConfiguration("codex", "https://app.example.com").redirectUri,
    ).toBe(CODEX_DEVICE_REDIRECT_URI);
  });

  it("uses app callback mode when a redirect URI override is set", () => {
    vi.stubEnv(
      "CLAUDE_OAUTH_REDIRECT_URI",
      "https://app.example.com/api/auth/oauth/claude/callback",
    );
    vi.stubEnv(
      "CODEX_OAUTH_REDIRECT_URI",
      "https://app.example.com/api/auth/oauth/codex/callback",
    );

    expect(getOAuthFlowMode("claude")).toBe("app_callback");
    expect(getOAuthFlowMode("codex")).toBe("app_callback");
    expect(
      getOAuthConfiguration("claude", "https://app.example.com").redirectUri,
    ).toBe("https://app.example.com/api/auth/oauth/claude/callback");
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
    vi.stubEnv(
      "CLAUDE_OAUTH_REDIRECT_URI",
      "https://app.example.com/api/auth/oauth/claude/callback",
    );
    vi.stubEnv(
      "CODEX_OAUTH_REDIRECT_URI",
      "https://app.example.com/api/auth/oauth/codex/callback",
    );
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
    expect(claude.searchParams.get("code")).toBe("true");
    expect(claude.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/auth/oauth/claude/callback",
    );
    expect(codex.searchParams.get("codex_cli_simplified_flow")).toBe("true");
    expect(codex.searchParams.get("client_id")).toBe("codex-client");
  });

  it("defaults Claude authorize requests to the manual Anthropic callback", () => {
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
    expect(claude.searchParams.get("redirect_uri")).toBe(
      CLAUDE_MANUAL_REDIRECT_URI,
    );
    expect(claude.searchParams.get("client_id")).toBe(
      DEFAULT_CLAUDE_OAUTH_CLIENT_ID,
    );
  });

  it("parses pasted Claude authorization codes with optional state", () => {
    expect(parseManualAuthorizationCode("abc123")).toEqual({
      code: "abc123",
      returnedState: undefined,
    });
    expect(parseManualAuthorizationCode("abc123#state-value")).toEqual({
      code: "abc123",
      returnedState: "state-value",
    });
  });

  it("exchanges a code without returning provider secrets to callers", async () => {
    vi.stubEnv("CODEX_OAUTH_CLIENT_ID", "codex-client");
    vi.stubEnv(
      "CODEX_OAUTH_REDIRECT_URI",
      "https://app.example.com/api/auth/oauth/codex/callback",
    );
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

describe("Cursor browser login", () => {
  it("is a deeplink flow with an env-overridable login URL", () => {
    vi.stubEnv("CURSOR_LOGIN_URL", "");
    expect(getOAuthFlowMode("cursor")).toBe("cursor_deeplink");
    expect(getOAuthConfigurationStatus("cursor")).toMatchObject({
      configured: true,
      flowMode: "cursor_deeplink",
    });
    expect(
      getOAuthConfiguration("cursor", "https://app.example.com").tokenUrl,
    ).toBe("https://api2.cursor.sh/auth/poll");

    vi.stubEnv("CURSOR_LOGIN_URL", "https://staging.example/deep");
    const start = startCursorLogin();
    expect(start.loginUrl.startsWith("https://staging.example/deep?")).toBe(
      true,
    );
    const url = new URL(start.loginUrl);
    expect(url.searchParams.get("uuid")).toBe(start.uuid);
    expect(url.searchParams.get("mode")).toBe("login");
    expect(url.searchParams.get("redirectTarget")).toBe("cli");
    // challenge = base64url(sha256(verifier))
    expect(url.searchParams.get("challenge")).toBe(
      pkceChallenge(start.verifier),
    );
  });

  it("maps the poll responses: 404 pending, 403 denied, 200 tokens", async () => {
    const responses = [
      new Response(null, { status: 404 }),
      new Response(null, { status: 403 }),
      new Response(
        JSON.stringify({ accessToken: "cur_at", refreshToken: "cur_rt" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => responses.shift() ?? new Response(null, { status: 500 }),
      ),
    );

    const input = { uuid: "u", verifier: "v" };
    expect(await pollCursorLogin(input)).toEqual({ status: "pending" });
    expect(await pollCursorLogin(input)).toEqual({ status: "denied" });
    expect(await pollCursorLogin(input)).toEqual({
      status: "ready",
      accessToken: "cur_at",
      refreshToken: "cur_rt",
    });
  });
});

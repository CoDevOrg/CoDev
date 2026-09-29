import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAuthorizationUrl,
  CODEX_DEVICE_REDIRECT_URI,
  createOAuthState,
  DEFAULT_CODEX_OAUTH_CLIENT_ID,
  exchangeCursorApiKey,
  exchangeOAuthCode,
  getOAuthConfiguration,
  getOAuthConfigurationStatus,
  getOAuthFlowMode,
  openOAuthState,
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
    vi.stubEnv("CODEX_OAUTH_CLIENT_ID", "");

    expect(getOAuthConfigurationStatus("codex")).toMatchObject({
      configured: true,
      flowMode: "device_code",
    });
    expect(
      getOAuthConfiguration("codex", "https://app.example.com").clientId,
    ).toBe(DEFAULT_CODEX_OAUTH_CLIENT_ID);
    expect(
      getOAuthConfiguration("codex", "https://app.example.com").redirectUri,
    ).toBe(CODEX_DEVICE_REDIRECT_URI);
  });

  it("uses app callback mode when a redirect URI override is set", () => {
    vi.stubEnv(
      "CODEX_OAUTH_REDIRECT_URI",
      "https://app.example.com/api/auth/oauth/codex/callback",
    );

    expect(getOAuthFlowMode("codex")).toBe("app_callback");
    expect(
      getOAuthConfiguration("codex", "https://app.example.com").redirectUri,
    ).toBe("https://app.example.com/api/auth/oauth/codex/callback");
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

  it("builds Codex authorization requests with S256 PKCE", () => {
    vi.stubEnv("CODEX_OAUTH_CLIENT_ID", "codex-client");
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

    const codex = buildAuthorizationUrl(
      getOAuthConfiguration("codex", "https://app.example.com"),
      state,
    );

    expect(codex.searchParams.get("code_challenge")).toBe(
      pkceChallenge(state.codeVerifier),
    );
    expect(codex.searchParams.get("code_challenge_method")).toBe("S256");
    expect(codex.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/auth/oauth/codex/callback",
    );
    expect(codex.searchParams.get("codex_cli_simplified_flow")).toBe("true");
    expect(codex.searchParams.get("client_id")).toBe("codex-client");
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

  it("posts the exchange as form encoding with the verified state", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "access-token" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await exchangeOAuthCode(
      getOAuthConfiguration("codex", "https://app.example.com"),
      "authorization-code",
      "code-verifier",
      "state-value",
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(
      Object.fromEntries(new URLSearchParams(init.body as string)),
    ).toMatchObject({
      grant_type: "authorization_code",
      code: "authorization-code",
      code_verifier: "code-verifier",
      state: "state-value",
    });
  });

  it("reports the provider's reason for a rejected exchange", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({ error_description: "code has expired" }),
      })),
    );

    await expect(
      exchangeOAuthCode(
        getOAuthConfiguration("codex", "https://app.example.com"),
        "authorization-code",
        "code-verifier",
        "state-value",
      ),
    ).rejects.toThrow(/status 400\. code has expired/);
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

  it("exchanges a user API key for the token pair", async () => {
    const seen: { url: string; headers: Headers; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push({
          url,
          headers: new Headers(init.headers),
          body: init.body,
        });
        return new Response(
          JSON.stringify({ accessToken: "x_at", refreshToken: "x_rt" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    await expect(exchangeCursorApiKey("  key_abc  ")).resolves.toEqual({
      accessToken: "x_at",
      refreshToken: "x_rt",
    });
    expect(seen[0]!.url).toBe(
      "https://api2.cursor.sh/auth/exchange_user_api_key",
    );
    expect(seen[0]!.headers.get("authorization")).toBe("Bearer key_abc");
  });

  it("rejects an unaccepted API key without leaking the status body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    await expect(exchangeCursorApiKey("key_bad")).rejects.toThrow(
      "not accepted",
    );
  });

  it("requires a non-empty key", async () => {
    await expect(exchangeCursorApiKey("   ")).rejects.toThrow("required");
  });
});

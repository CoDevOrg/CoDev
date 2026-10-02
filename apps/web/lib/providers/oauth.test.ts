import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAuthorizationUrl,
  CODEX_DEVICE_REDIRECT_URI,
  createOAuthState,
  DEFAULT_CODEX_OAUTH_CLIENT_ID,
  exchangeOAuthCode,
  getOAuthConfiguration,
  getOAuthConfigurationStatus,
  getOAuthFlowMode,
  openOAuthState,
  pkceChallenge,
  sealOAuthState,
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

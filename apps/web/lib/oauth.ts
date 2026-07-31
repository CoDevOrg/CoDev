import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { AuthProvider, ScopeType } from "@codev/shared-types";

import { saveProviderCredential } from "./credentials";

export type OAuthProvider = "claude" | "codex";

export type OAuthState = {
  state: string;
  codeVerifier: string;
  userId: string;
  scopeType: ScopeType;
  scopeId: string;
  returnTo: string;
};

type OAuthConfiguration = {
  provider: AuthProvider;
  clientId: string;
  clientSecret?: string | undefined;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  redirectUri: string;
};

const COOKIE_MAX_AGE_SECONDS = 10 * 60;

export function oauthCookieName(provider: OAuthProvider) {
  return `codev_oauth_${provider}`;
}

export function oauthCallbackPath(provider: OAuthProvider) {
  return `/api/auth/oauth/${provider}/callback`;
}

function cookieSecret() {
  const secret = process.env.AUTH_SECRET ?? process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("AUTH_SECRET or CREDENTIAL_ENCRYPTION_KEY is required for OAuth state.");
  }
  return secret;
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function sealOAuthState(state: OAuthState) {
  const payload = encode(JSON.stringify(state));
  const signature = createHmac("sha256", cookieSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function openOAuthState(value: string): OAuthState {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) throw new Error("Invalid OAuth state.");
  const expected = createHmac("sha256", cookieSecret())
    .update(payload)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid OAuth state.");
  }
  const parsed = JSON.parse(decode(payload)) as Partial<OAuthState>;
  if (
    typeof parsed.state !== "string" ||
    typeof parsed.codeVerifier !== "string" ||
    typeof parsed.userId !== "string" ||
    (parsed.scopeType !== "USER" && parsed.scopeType !== "WORKSPACE") ||
    typeof parsed.scopeId !== "string" ||
    typeof parsed.returnTo !== "string"
  ) {
    throw new Error("Invalid OAuth state.");
  }
  return parsed as OAuthState;
}

export function createOAuthState(input: Omit<OAuthState, "state" | "codeVerifier">) {
  return {
    ...input,
    state: randomBytes(32).toString("base64url"),
    codeVerifier: randomBytes(64).toString("base64url"),
  } satisfies OAuthState;
}

export function pkceChallenge(codeVerifier: string) {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function envUrl(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

export function getOAuthConfiguration(
  provider: OAuthProvider,
  origin: string,
): OAuthConfiguration {
  if (provider === "claude") {
    const clientId = process.env.CLAUDE_OAUTH_CLIENT_ID?.trim();
    if (!clientId) throw new Error("CLAUDE_OAUTH_CLIENT_ID is not configured.");
    return {
      provider: "anthropic",
      clientId,
      clientSecret: process.env.CLAUDE_OAUTH_CLIENT_SECRET,
      authorizeUrl: envUrl(
        "CLAUDE_OAUTH_AUTHORIZE_URL",
        "https://claude.ai/oauth/authorize",
      ),
      tokenUrl: envUrl(
        "CLAUDE_OAUTH_TOKEN_URL",
        "https://console.anthropic.com/v1/oauth/token",
      ),
      scope: envUrl(
        "CLAUDE_OAUTH_SCOPE",
        "claude_code:write user:profile offline_access",
      ),
      redirectUri: envUrl(
        "CLAUDE_OAUTH_REDIRECT_URI",
        `${origin}${oauthCallbackPath(provider)}`,
      ),
    };
  }

  const clientId = process.env.CODEX_OAUTH_CLIENT_ID?.trim();
  if (!clientId) throw new Error("CODEX_OAUTH_CLIENT_ID is not configured.");
  return {
    provider: "openai",
    clientId,
    clientSecret: process.env.CODEX_OAUTH_CLIENT_SECRET,
    authorizeUrl: envUrl(
      "CODEX_OAUTH_AUTHORIZE_URL",
      "https://auth.openai.com/oauth/authorize",
    ),
    tokenUrl: envUrl(
      "CODEX_OAUTH_TOKEN_URL",
      "https://auth.openai.com/oauth/token",
    ),
    scope: envUrl(
      "CODEX_OAUTH_SCOPE",
      "openid profile email offline_access api.connectors.read api.connectors.invoke",
    ),
    redirectUri: envUrl(
      "CODEX_OAUTH_REDIRECT_URI",
      `${origin}${oauthCallbackPath(provider)}`,
    ),
  };
}

export function buildAuthorizationUrl(
  configuration: OAuthConfiguration,
  state: OAuthState,
) {
  const url = new URL(configuration.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", configuration.clientId);
  url.searchParams.set("redirect_uri", configuration.redirectUri);
  url.searchParams.set("scope", configuration.scope);
  url.searchParams.set("state", state.state);
  url.searchParams.set("code_challenge", pkceChallenge(state.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  if (configuration.provider === "openai") {
    url.searchParams.set("codex_cli_simplified_flow", "true");
    url.searchParams.set("id_token_add_organizations", "true");
  }
  return url;
}

function expiresAtFrom(value: unknown) {
  if (typeof value !== "number" || value <= 0) return undefined;
  return new Date(Date.now() + value * 1_000);
}

export async function exchangeOAuthCode(
  configuration: OAuthConfiguration,
  code: string,
  codeVerifier: string,
) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: configuration.clientId,
    redirect_uri: configuration.redirectUri,
    code_verifier: codeVerifier,
  });
  if (configuration.clientSecret) {
    body.set("client_secret", configuration.clientSecret);
  }

  const response = await fetch(configuration.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed with status ${response.status}.`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  if (typeof payload.access_token !== "string") {
    throw new Error("OAuth token exchange returned no access token.");
  }
  return {
    accessToken: payload.access_token,
    refreshToken:
      typeof payload.refresh_token === "string"
        ? payload.refresh_token
        : undefined,
    expiresAt: expiresAtFrom(payload.expires_in),
  };
}

export async function persistOAuthTokens(
  state: OAuthState,
  configuration: OAuthConfiguration,
  tokens: Awaited<ReturnType<typeof exchangeOAuthCode>>,
) {
  await saveProviderCredential({
    scopeType: state.scopeType,
    scopeId: state.scopeId,
    provider: configuration.provider,
    credentialType: "OAUTH_TOKEN",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  });
}

export { COOKIE_MAX_AGE_SECONDS };

import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { AuthProvider, ScopeType } from "@codev/shared-types";

import { saveProviderCredential } from "./credentials";

export type OAuthProvider = "claude" | "codex";
export type OAuthFlowMode = "app_callback" | "manual_code" | "device_code";

/** Public Claude Code PKCE client used by the official CLI. */
export const DEFAULT_CLAUDE_OAUTH_CLIENT_ID =
  "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
/**
 * Public Codex CLI PKCE client used by the official CLI.
 * This is used only by the legacy/test OAuth connection. Hosted cloud Codex
 * authentication delegates to the official CLI through `codev codex-auth`.
 */
export const DEFAULT_CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export const CLAUDE_MANUAL_REDIRECT_URI =
  "https://console.anthropic.com/oauth/code/callback";
export const CODEX_DEVICE_REDIRECT_URI =
  "https://auth.openai.com/deviceauth/callback";
export const CODEX_DEVICE_VERIFICATION_URL =
  "https://auth.openai.com/codex/device";
const CODEX_DEVICE_USERCODE_URL =
  "https://auth.openai.com/api/accounts/deviceauth/usercode";
const CODEX_DEVICE_TOKEN_URL =
  "https://auth.openai.com/api/accounts/deviceauth/token";

export class OAuthConfigurationError extends Error {
  readonly provider: OAuthProvider;
  readonly missing: readonly string[];

  constructor(provider: OAuthProvider, missing: readonly string[]) {
    super(`OAuth is not configured for ${provider}.`);
    this.name = "OAuthConfigurationError";
    this.provider = provider;
    this.missing = missing;
  }
}

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
  flowMode: OAuthFlowMode;
};

const COOKIE_MAX_AGE_SECONDS = 10 * 60;

export function oauthCookieName(provider: OAuthProvider) {
  return `codev_oauth_${provider}`;
}

export function oauthCallbackPath(provider: OAuthProvider) {
  return `/api/auth/oauth/${provider}/callback`;
}

function cookieSecret() {
  const secret =
    process.env.AUTH_SECRET ?? process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET or CREDENTIAL_ENCRYPTION_KEY is required for OAuth state.",
    );
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

export function createOAuthState(
  input: Omit<OAuthState, "state" | "codeVerifier">,
) {
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

function envOptional(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function clientIdEnvName(provider: OAuthProvider) {
  return provider === "claude"
    ? "CLAUDE_OAUTH_CLIENT_ID"
    : "CODEX_OAUTH_CLIENT_ID";
}

export function resolveOAuthClientId(provider: OAuthProvider) {
  if (provider === "claude") {
    return (
      envOptional("CLAUDE_OAUTH_CLIENT_ID") ?? DEFAULT_CLAUDE_OAUTH_CLIENT_ID
    );
  }
  return envOptional("CODEX_OAUTH_CLIENT_ID") ?? DEFAULT_CODEX_OAUTH_CLIENT_ID;
}

export function getOAuthFlowMode(provider: OAuthProvider): OAuthFlowMode {
  if (provider === "claude") {
    return envOptional("CLAUDE_OAUTH_REDIRECT_URI")
      ? "app_callback"
      : "manual_code";
  }
  return envOptional("CODEX_OAUTH_REDIRECT_URI")
    ? "app_callback"
    : "device_code";
}

export function getOAuthConfigurationStatus(provider: OAuthProvider) {
  // Public CLI client IDs are used when env vars are unset, so subscription
  // OAuth is available without a separately registered provider app.
  return {
    configured: Boolean(resolveOAuthClientId(provider)),
    missing: [] as string[],
    flowMode: getOAuthFlowMode(provider),
    clientIdEnv: clientIdEnvName(provider),
  };
}

export function getOAuthConfiguration(
  provider: OAuthProvider,
  origin: string,
): OAuthConfiguration {
  const flowMode = getOAuthFlowMode(provider);
  if (provider === "claude") {
    const clientId = resolveOAuthClientId(provider);
    return {
      provider: "anthropic",
      clientId,
      clientSecret: envOptional("CLAUDE_OAUTH_CLIENT_SECRET"),
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
        "org:create_api_key user:profile user:inference",
      ),
      redirectUri: envUrl(
        "CLAUDE_OAUTH_REDIRECT_URI",
        flowMode === "manual_code"
          ? CLAUDE_MANUAL_REDIRECT_URI
          : `${origin}${oauthCallbackPath(provider)}`,
      ),
      flowMode,
    };
  }

  const clientId = resolveOAuthClientId(provider);
  return {
    provider: "openai",
    clientId,
    clientSecret: envOptional("CODEX_OAUTH_CLIENT_SECRET"),
    authorizeUrl: envUrl(
      "CODEX_OAUTH_AUTHORIZE_URL",
      "https://auth.openai.com/oauth/authorize",
    ),
    tokenUrl: envUrl(
      "CODEX_OAUTH_TOKEN_URL",
      "https://auth.openai.com/oauth/token",
    ),
    scope: envUrl("CODEX_OAUTH_SCOPE", "openid profile email offline_access"),
    redirectUri: envUrl(
      "CODEX_OAUTH_REDIRECT_URI",
      flowMode === "device_code"
        ? CODEX_DEVICE_REDIRECT_URI
        : `${origin}${oauthCallbackPath(provider)}`,
    ),
    flowMode,
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
  if (configuration.provider === "anthropic") {
    url.searchParams.set("code", "true");
  }
  if (configuration.provider === "openai") {
    url.searchParams.set("codex_cli_simplified_flow", "true");
    url.searchParams.set("id_token_add_organizations", "true");
  }
  return url;
}

export function parseManualAuthorizationCode(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Authorization code is required.");
  }
  const hashIndex = trimmed.indexOf("#");
  if (hashIndex >= 0) {
    return {
      code: trimmed.slice(0, hashIndex),
      returnedState: trimmed.slice(hashIndex + 1) || undefined,
    };
  }
  return { code: trimmed, returnedState: undefined };
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
    throw new Error(
      `OAuth token exchange failed with status ${response.status}.`,
    );
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

export type CodexDeviceCode = {
  verificationUrl: string;
  userCode: string;
  deviceAuthId: string;
  intervalSeconds: number;
};

export async function requestCodexDeviceCode(
  clientId: string,
): Promise<CodexDeviceCode> {
  const response = await fetch(CODEX_DEVICE_USERCODE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
    cache: "no-store",
  });
  if (response.status === 404) {
    throw new Error(
      "Codex device code login is not enabled for this account. Enable it in ChatGPT security settings, or set CODEX_OAUTH_REDIRECT_URI for an app-callback client.",
    );
  }
  if (!response.ok) {
    throw new Error(
      `Codex device code request failed with status ${response.status}.`,
    );
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const userCode =
    typeof payload.user_code === "string"
      ? payload.user_code
      : typeof payload.usercode === "string"
        ? payload.usercode
        : undefined;
  const deviceAuthId =
    typeof payload.device_auth_id === "string"
      ? payload.device_auth_id
      : undefined;
  if (!userCode || !deviceAuthId) {
    throw new Error("Codex device code response was incomplete.");
  }
  const intervalRaw = payload.interval;
  const intervalSeconds =
    typeof intervalRaw === "number"
      ? intervalRaw
      : typeof intervalRaw === "string"
        ? Number.parseInt(intervalRaw, 10)
        : 5;
  return {
    verificationUrl: CODEX_DEVICE_VERIFICATION_URL,
    userCode,
    deviceAuthId,
    intervalSeconds:
      Number.isFinite(intervalSeconds) && intervalSeconds > 0
        ? intervalSeconds
        : 5,
  };
}

export type CodexDevicePollResult =
  | { status: "pending" }
  | {
      status: "ready";
      authorizationCode: string;
      codeVerifier: string;
    };

export async function pollCodexDeviceCode(input: {
  deviceAuthId: string;
  userCode: string;
}): Promise<CodexDevicePollResult> {
  const response = await fetch(CODEX_DEVICE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device_auth_id: input.deviceAuthId,
      user_code: input.userCode,
    }),
    cache: "no-store",
  });
  if (response.status === 403 || response.status === 404) {
    return { status: "pending" };
  }
  if (!response.ok) {
    throw new Error(
      `Codex device authorization failed with status ${response.status}.`,
    );
  }
  const payload = (await response.json()) as Record<string, unknown>;
  if (
    typeof payload.authorization_code !== "string" ||
    typeof payload.code_verifier !== "string"
  ) {
    throw new Error("Codex device authorization response was incomplete.");
  }
  return {
    status: "ready",
    authorizationCode: payload.authorization_code,
    codeVerifier: payload.code_verifier,
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

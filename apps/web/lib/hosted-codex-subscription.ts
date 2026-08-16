import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { HostedCodexScopeType } from "@codev/shared-types";

import { isHostedCodexSubscriptionEnabled } from "./hosted-codex-subscription-flag";

/** Public Codex CLI client. Hosted CoDev must never fall back to it. */
export const FORBIDDEN_CODEX_PUBLIC_CLI_CLIENT_ID =
  "app_EMoamEEZ73f0CkXaXp7hrann";

export const HOSTED_CODEX_CALLBACK_PATH = "/api/auth/hosted-codex/callback";
export const HOSTED_CODEX_COOKIE_NAME = "codev_hosted_codex";
export const HOSTED_CODEX_ATTEMPT_TTL_MS = 10 * 60 * 1_000;
export const HOSTED_CODEX_RUNTIME_GRANT_TTL_MS = 15 * 60 * 1_000;

export type HostedCodexApprovedConfig = {
  clientId: string;
  clientSecret?: string;
  authorizeUrl: string;
  tokenUrl: string;
  revocationUrl?: string;
  redirectUri: string;
  issuer: string;
  scopes: string;
  runtimeGrantUrl?: string;
};

let testConfigOverride: HostedCodexApprovedConfig | null | undefined;

function envOptional(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function rejectPublicCliClient(clientId: string) {
  if (clientId === FORBIDDEN_CODEX_PUBLIC_CLI_CLIENT_ID) {
    throw new Error(
      "The Codex public CLI client ID is not an approved hosted CoDev client.",
    );
  }
}

export function createHostedCodexPkceVerifier() {
  return randomBytes(32).toString("base64url");
}

export function hostedCodexPkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createHostedCodexOpaqueId() {
  return randomBytes(32).toString("base64url");
}

export function safeHostedCodexReturnTo(
  value: string | null | undefined,
  fallback: string,
) {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : fallback;
}

export function redactHostedCodexAccountLabel(
  value: string | null | undefined,
) {
  const trimmed = value?.trim();
  if (!trimmed) return "connected account";
  if (trimmed.includes("@")) {
    const [local, domain] = trimmed.split("@");
    const visible = (local ?? "").slice(0, 1);
    return `${visible}…@${domain}`;
  }
  if (trimmed.length <= 4) return "connected account";
  return `ending ${trimmed.slice(-4)}`;
}

export function setHostedCodexApprovedConfigForTests(
  config: HostedCodexApprovedConfig | null | undefined,
) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Hosted Codex test config cannot be set outside tests.");
  }
  testConfigOverride = config;
}

export function getHostedCodexApprovedConfig(): HostedCodexApprovedConfig | null {
  if (!isHostedCodexSubscriptionEnabled()) return null;
  if (process.env.NODE_ENV === "test" && testConfigOverride !== undefined) {
    return testConfigOverride;
  }

  const clientId = envOptional("HOSTED_CODEX_APPROVED_CLIENT_ID");
  const authorizeUrl = envOptional("HOSTED_CODEX_APPROVED_AUTHORIZE_URL");
  const tokenUrl = envOptional("HOSTED_CODEX_APPROVED_TOKEN_URL");
  const redirectUri = envOptional("HOSTED_CODEX_APPROVED_REDIRECT_URI");
  const issuer = envOptional("HOSTED_CODEX_APPROVED_ISSUER");
  const scopes = envOptional("HOSTED_CODEX_APPROVED_SCOPE");
  if (
    !clientId ||
    !authorizeUrl ||
    !tokenUrl ||
    !redirectUri ||
    !issuer ||
    !scopes
  ) {
    return null;
  }
  rejectPublicCliClient(clientId);
  if (!redirectUri.startsWith("https://")) {
    throw new Error("The hosted Codex redirect URI must be HTTPS.");
  }
  const clientSecret = envOptional("HOSTED_CODEX_APPROVED_CLIENT_SECRET");
  const revocationUrl = envOptional("HOSTED_CODEX_APPROVED_REVOCATION_URL");
  const runtimeGrantUrl = envOptional(
    "HOSTED_CODEX_APPROVED_RUNTIME_GRANT_URL",
  );
  return {
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    authorizeUrl,
    tokenUrl,
    ...(revocationUrl ? { revocationUrl } : {}),
    redirectUri,
    issuer,
    scopes,
    ...(runtimeGrantUrl ? { runtimeGrantUrl } : {}),
  };
}

export function buildHostedCodexAuthorizationUrl(input: {
  config: HostedCodexApprovedConfig;
  state: string;
  codeChallenge: string;
  nonce: string;
  scopeType: HostedCodexScopeType;
}) {
  const url = new URL(input.config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("scope", input.config.scopes);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("codev_scope", input.scopeType.toLowerCase());
  return url;
}

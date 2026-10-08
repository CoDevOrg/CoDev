import "server-only";
import { z } from "zod";
import { buildCodexAuthCacheJson } from "./codex-oauth-connection";
import { credentialSeatHolder } from "./credential-seat";
import { updateHostedCodexAuthCacheIfCurrent } from "./hosted-codex-subscription-credentials";
import { getOAuthConfiguration } from "./oauth";
import type { ResolvedSecret } from "./registry";

// Refresh slightly early so a catalog request never races the expiry.
const EXPIRY_MARGIN_MS = 5 * 60_000;
// OpenAI reports a refresh token that can never succeed again with these codes.
const RECONNECT_CODES = new Set([
  "refresh_token_expired",
  "refresh_token_reused",
  "refresh_token_invalidated",
  "invalid_grant",
]);

const authCache = z.object({
  tokens: z.object({
    access_token: z.string(),
    refresh_token: z.string(),
    id_token: z.string().optional(),
  }),
});
const refreshed = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
});

export class CodexReconnectRequiredError extends Error {
  constructor() {
    super("Your ChatGPT sign-in expired. Reconnect Codex in Settings.");
    this.name = "CodexReconnectRequiredError";
  }
}

function expiresAt(token: string) {
  try {
    const { exp } = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
    ) as { exp?: unknown };
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** The same refresh request the pinned Codex CLI sends. */
async function requestRefresh(refreshToken: string) {
  const { tokenUrl, clientId } = getOAuthConfiguration("codex", "");
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "openid profile email",
    }),
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  if (response.ok) return refreshed.parse(payload);
  // Log only the status and OpenAI's error code, never a body or token.
  const code = typeof payload?.error === "string" ? payload.error : undefined;
  console.warn("Codex token refresh failed", { status: response.status, code });
  if (code && RECONNECT_CODES.has(code))
    throw new CodexReconnectRequiredError();
  throw new Error("Codex sign-in refresh is unavailable.");
}

/**
 * Model discovery runs outside turns, where nothing else refreshes the ChatGPT
 * access token. Refresh an expired one and save the rotated tokens, so the
 * catalog (and the turn it gates) keep working without a reconnect. `force`
 * refreshes a token ChatGPT rejected before its expiry.
 */
export async function freshCodexSecret(
  credential: {
    credentialId: string | null;
    credentialRevision: string | null;
    secret: ResolvedSecret;
  },
  { force = false } = {},
): Promise<ResolvedSecret> {
  const { credentialId, credentialRevision, secret } = credential;
  if (
    secret.kind !== "codex_auth_cache" ||
    !credentialId ||
    !credentialRevision
  )
    return secret;
  const { tokens } = authCache.parse(JSON.parse(secret.authCacheJson));
  const expiry = expiresAt(tokens.access_token);
  if (!force && (expiry === null || expiry - Date.now() > EXPIRY_MARGIN_MS))
    return secret;
  // A running turn's CLI refreshes the same rotating token and saves it on exit.
  if (await credentialSeatHolder(credentialId)) return secret;
  const next = await requestRefresh(tokens.refresh_token);
  const authCacheJson = buildCodexAuthCacheJson({
    accessToken: next.access_token,
    refreshToken: next.refresh_token ?? tokens.refresh_token,
    idToken: next.id_token ?? tokens.id_token,
  });
  // A newer sign-in or a turn's save is authoritative; never overwrite it.
  if (
    !(await updateHostedCodexAuthCacheIfCurrent(
      credentialId,
      credentialRevision,
      authCacheJson,
    ))
  )
    throw new Error("Your Codex connection changed. Refresh and try again.");
  return { kind: "codex_auth_cache", authCacheJson };
}

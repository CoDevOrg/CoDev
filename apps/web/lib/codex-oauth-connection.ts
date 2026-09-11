import "server-only";

import type { ScopeType } from "@codev/shared-types";

import { persistHostedCodexConnection } from "./hosted-codex-subscription-credentials";

/**
 * Bridge from an OpenAI OAuth exchange to the Codex CLI's on-disk credential.
 *
 * The device-code / callback OAuth flows yield `{ accessToken, refreshToken,
 * idToken }`, but the runtime that actually answers turns runs `codex exec`,
 * which reads a `~/.codex/auth.json` file (materialized by
 * `write_codex_credential` in the orchestrator). This module shapes the OAuth
 * tokens into that exact file and persists it as the `HOSTED_CODEX_SUBSCRIPTION`
 * credential the prod path already consumes — so connecting ChatGPT in-app is
 * indistinguishable, downstream, from the `codev codex-auth` CLI upload.
 */

export type CodexOAuthTokens = {
  accessToken: string;
  refreshToken?: string | undefined;
  idToken?: string | undefined;
};

/**
 * The ChatGPT account id the Codex CLI stores in `auth.json` lives in a custom
 * claim inside the OpenAI id_token JWT (`https://api.openai.com/auth` →
 * `chatgpt_account_id`). Decode the JWT payload segment to recover it; the CLI
 * can still refresh without it, so any parse failure degrades to `undefined`.
 */
export function chatgptAccountIdFromIdToken(
  idToken: string | undefined,
): string | undefined {
  if (!idToken) return undefined;
  const segment = idToken.split(".")[1];
  if (!segment) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(segment, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"];
    if (auth && typeof auth === "object" && !Array.isArray(auth)) {
      const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
      if (typeof accountId === "string" && accountId) return accountId;
    }
  } catch {
    // Malformed token — the CLI repopulates these fields on its first refresh.
  }
  return undefined;
}

/**
 * Build the `~/.codex/auth.json` blob the Codex CLI writes after `codex login`.
 * Mirrors the file `validateCodexAuthCache` accepts from the CLI upload path.
 */
export function buildCodexAuthCacheJson(tokens: CodexOAuthTokens): string {
  if (!tokens.refreshToken) {
    throw new Error(
      "ChatGPT sign-in did not return a refresh token. Try connecting again.",
    );
  }
  return JSON.stringify({
    // Codex keys its auth on `auth_mode`: "chatgpt" tells the CLI to drive
    // `codex exec` off the subscription tokens below. Omitting it makes the
    // CLI fall back to API-key auth (with a null OPENAI_API_KEY) and hang, so
    // this field is required, not cosmetic.
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: tokens.idToken ?? "",
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      account_id: chatgptAccountIdFromIdToken(tokens.idToken) ?? "",
    },
    last_refresh: new Date().toISOString(),
  });
}

/**
 * Persist a ChatGPT subscription connection obtained through OAuth as the
 * `HOSTED_CODEX_SUBSCRIPTION` credential used by `codex exec` (chat replies,
 * agents, and IDE seeding).
 */
export async function persistCodexSubscriptionFromOAuth(input: {
  userId: string;
  scopeType: ScopeType;
  scopeId: string;
  tokens: CodexOAuthTokens;
}) {
  const authCacheJson = buildCodexAuthCacheJson(input.tokens);
  // Hosted Codex credentials scope to USER or ORGANIZATION; a WORKSPACE-scoped
  // OAuth session persists as the shared organization connection.
  const scopeType = input.scopeType === "USER" ? "USER" : "ORGANIZATION";
  await persistHostedCodexConnection({
    userId: input.userId,
    scopeType,
    scopeId: input.scopeId,
    sharingEnabled: scopeType === "ORGANIZATION",
    material: { authCacheJson },
    accountLabel: "ChatGPT",
  });
}

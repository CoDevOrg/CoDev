import "server-only";

import { saveCursorCredential } from "./cursor-api-key";
import {
  deleteProviderCredential,
  listProviderCredentialStatuses,
  saveAnthropicCredential,
  saveOpenAICredential,
} from "./credentials";
import { isHostedClaudeConnectEnabled } from "./claude-connection-runner";
import { isHostedCodexSubscriptionEnabled } from "./hosted-codex-subscription-flag";
import { disconnectClaudeRuntime } from "./claude-connection-session";
import { disconnectHostedCodexSubscription } from "./hosted-codex-subscription-credentials";
import { getOAuthFlowMode } from "./oauth";
import {
  publicProviderConnectionPayload,
  toProviderConnectionSnapshot,
  type CliSubscriptionProvider,
  type ProviderConnectionProvider,
  type ProviderConnectionSnapshot,
} from "./provider-connection-view";

type ConnectionUser = {
  id: string;
  name?: string | null;
  githubLogin?: string;
};

export async function loadProviderConnectionSnapshot(
  user: ConnectionUser,
): Promise<ProviderConnectionSnapshot> {
  const status = await listProviderCredentialStatuses(user.id);
  const openai = status("openai", "API_KEY");
  const anthropic = status("anthropic", "API_KEY");
  const cursor = status("cursor", "API_KEY");
  const hostedCodex = status("openai", "HOSTED_CODEX_SUBSCRIPTION");
  const codexOAuth = status("openai", "OAUTH_TOKEN");
  // Only a CLI-stamped setup-token is reported; a browser-era token is not.
  const claudeCliToken = status("anthropic", "OAUTH_TOKEN");
  const cursorCli = status("cursor", "OAUTH_TOKEN");
  return toProviderConnectionSnapshot({
    viewer: {
      id: user.id,
      name: user.name?.trim() || user.githubLogin?.trim() || "Unknown user",
    },
    statuses: {
      openai,
      anthropic,
      cursor,
    },
    cliSubscriptionStatuses: {
      // The CLI and in-page device-code flow both produce the same auth cache.
      codex: hostedCodex ?? codexOAuth,
      // Claude's CLI setup-token stays separate from the hosted login.
      claude: claudeCliToken,
      cursor: cursorCli,
    },
    claudeCliToken,
    connectModes: {
      codex: getOAuthFlowMode("codex"),
      // Claude has no CoDev-run OAuth flow: the in-app button drives the
      // official login runtime, and the fallback is `codev claude-auth`.
      claude: "manual_code",
    },
    hostedClaudeConnect: isHostedClaudeConnectEnabled(),
    hostedOpenAIConnect: isHostedCodexSubscriptionEnabled(),
  });
}

/**
 * Save a pasted API key.
 *
 * The settings section it was pasted in used to decide which surfaces the key
 * was enabled for. It no longer does: where an API key can run is the
 * registry's answer, and a key pasted in one section was never usable in the
 * other anyway. The request may still carry `surface`; it is ignored.
 */
export async function savePersonalProviderConnection(
  user: ConnectionUser,
  provider: ProviderConnectionProvider,
  apiKey: string,
): Promise<ProviderConnectionSnapshot> {
  if (provider === "openai") {
    await saveOpenAICredential(user.id, apiKey);
  } else if (provider === "anthropic") {
    await saveAnthropicCredential(user.id, apiKey);
  } else {
    await saveCursorCredential(user.id, apiKey);
  }
  return publicProviderConnectionPayload(
    await loadProviderConnectionSnapshot(user),
    apiKey,
  );
}

/**
 * Revoke a pasted API key, or — `kind: "claude_cli_token"` — the Claude
 * setup-token uploaded with `codev claude-auth`, which lives in its own row.
 */
export async function revokePersonalProviderConnection(
  user: ConnectionUser,
  provider: ProviderConnectionProvider,
  kind: "api_key" | "claude_cli_token" = "api_key",
): Promise<ProviderConnectionSnapshot> {
  if (kind === "claude_cli_token") {
    if (provider !== "anthropic")
      throw new Error("Only Claude has a CLI token.");
    await deleteProviderCredential(user.id, "anthropic", "OAUTH_TOKEN");
  } else {
    await deleteProviderCredential(user.id, provider, "API_KEY");
  }
  return publicProviderConnectionPayload(
    await loadProviderConnectionSnapshot(user),
  );
}

/**
 * Sign the member out of an agent subscription. Codex has two possible
 * logins — the CLI's hosted auth cache and the in-page device flow — so both
 * are cleared rather than leaving a stale one behind that keeps the card
 * showing "Connected" after a disconnect.
 */
export async function revokePersonalSubscription(
  user: ConnectionUser,
  provider: CliSubscriptionProvider,
): Promise<ProviderConnectionSnapshot> {
  if (provider === "claude") {
    await disconnectClaudeRuntime(user.id);
    await deleteProviderCredential(user.id, "anthropic", "OAUTH_TOKEN");
  } else if (provider === "cursor") {
    await deleteProviderCredential(user.id, "cursor", "OAUTH_TOKEN");
  } else {
    await Promise.all([
      disconnectHostedCodexSubscription({
        userId: user.id,
      }),
      deleteProviderCredential(user.id, "openai", "OAUTH_TOKEN"),
    ]);
  }
  return publicProviderConnectionPayload(
    await loadProviderConnectionSnapshot(user),
  );
}

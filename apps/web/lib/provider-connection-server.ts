import "server-only";

import {
  deleteProviderCredential,
  getProviderCredentialStatus,
  saveAnthropicCredential,
  saveCursorCredential,
  saveOpenAICredential,
} from "./credentials";
import { disconnectHostedCodexSubscription } from "./hosted-codex-subscription-credentials";
import { getOAuthFlowMode } from "./oauth";
import {
  publicProviderConnectionPayload,
  toProviderConnectionSnapshot,
  type CliSubscriptionProvider,
  type ProviderConnectionProvider,
  type ProviderConnectionSnapshot,
} from "./provider-connection-view";
import { displayMemberName } from "./shared-session-view";

type ConnectionUser = {
  id: string;
  name?: string | null;
  githubLogin?: string;
};

export async function loadProviderConnectionSnapshot(
  user: ConnectionUser,
): Promise<ProviderConnectionSnapshot> {
  const [
    openai,
    anthropic,
    cursorKey,
    hostedCodex,
    codexOAuth,
    claudeOAuth,
    cursorOAuth,
  ] = await Promise.all([
    getProviderCredentialStatus("USER", user.id, "openai", "API_KEY"),
    getProviderCredentialStatus("USER", user.id, "anthropic", "API_KEY"),
    getProviderCredentialStatus("USER", user.id, "cursor", "API_KEY"),
    getProviderCredentialStatus(
      "USER",
      user.id,
      "openai",
      "HOSTED_CODEX_SUBSCRIPTION",
    ),
    getProviderCredentialStatus("USER", user.id, "openai", "OAUTH_TOKEN"),
    getProviderCredentialStatus("USER", user.id, "anthropic", "OAUTH_TOKEN"),
    getProviderCredentialStatus("USER", user.id, "cursor", "OAUTH_TOKEN"),
  ]);
  return toProviderConnectionSnapshot({
    viewer: {
      id: user.id,
      name: displayMemberName(user.name, user.githubLogin),
    },
    statuses: {
      openai,
      anthropic,
      cursor: cursorKey,
    },
    cliSubscriptionStatuses: {
      // Codex counts as signed in whether the login arrived through the CoDev
      // CLI (hosted auth cache) or the in-page device-code flow.
      codex: hostedCodex ?? codexOAuth,
      claude: claudeOAuth,
      cursor: cursorOAuth,
    },
    connectModes: {
      codex: getOAuthFlowMode("codex"),
      claude: getOAuthFlowMode("claude"),
      cursor: "cursor_deeplink",
    },
  });
}

export async function savePersonalProviderConnection(
  user: ConnectionUser,
  provider: ProviderConnectionProvider,
  apiKey: string,
): Promise<ProviderConnectionSnapshot> {
  if (provider === "openai") {
    await saveOpenAICredential(user.id, apiKey);
  } else if (provider === "cursor") {
    await saveCursorCredential(user.id, apiKey);
  } else {
    await saveAnthropicCredential(user.id, apiKey);
  }
  return publicProviderConnectionPayload(
    await loadProviderConnectionSnapshot(user),
    apiKey,
  );
}

export async function revokePersonalProviderConnection(
  user: ConnectionUser,
  provider: ProviderConnectionProvider,
): Promise<ProviderConnectionSnapshot> {
  await deleteProviderCredential("USER", user.id, provider, "API_KEY");
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
    await deleteProviderCredential("USER", user.id, "anthropic", "OAUTH_TOKEN");
  } else if (provider === "cursor") {
    await deleteProviderCredential("USER", user.id, "cursor", "OAUTH_TOKEN");
  } else {
    await Promise.all([
      disconnectHostedCodexSubscription({
        userId: user.id,
        scopeType: "USER",
        scopeId: user.id,
      }),
      deleteProviderCredential("USER", user.id, "openai", "OAUTH_TOKEN"),
    ]);
  }
  return publicProviderConnectionPayload(
    await loadProviderConnectionSnapshot(user),
  );
}

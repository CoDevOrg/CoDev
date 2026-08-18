import "server-only";

import {
  deleteProviderCredential,
  getProviderCredentialStatus,
  saveAnthropicCredential,
  saveOpenAICredential,
} from "./credentials";
import {
  publicProviderConnectionPayload,
  toProviderConnectionSnapshot,
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
  const [openai, anthropic, codexCli, claudeCli] = await Promise.all([
    getProviderCredentialStatus("USER", user.id, "openai", "API_KEY"),
    getProviderCredentialStatus("USER", user.id, "anthropic", "API_KEY"),
    getProviderCredentialStatus(
      "USER",
      user.id,
      "openai",
      "HOSTED_CODEX_SUBSCRIPTION",
    ),
    getProviderCredentialStatus("USER", user.id, "anthropic", "OAUTH_TOKEN"),
  ]);
  return toProviderConnectionSnapshot({
    viewer: {
      id: user.id,
      name: displayMemberName(user.name, user.githubLogin),
    },
    statuses: {
      openai,
      anthropic,
    },
    cliSubscriptionStatuses: {
      codex: codexCli,
      claude: claudeCli,
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

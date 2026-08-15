import "server-only";

import {
  deleteOpenAICredential,
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
  const [openai, anthropic] = await Promise.all([
    getProviderCredentialStatus("USER", user.id, "openai"),
    getProviderCredentialStatus("USER", user.id, "anthropic"),
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
  if (provider === "openai") {
    await deleteOpenAICredential(user.id);
  } else {
    await deleteProviderCredential("USER", user.id, "anthropic");
  }
  return publicProviderConnectionPayload(
    await loadProviderConnectionSnapshot(user),
  );
}

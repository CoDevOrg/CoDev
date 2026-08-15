import "server-only";

import {
  deleteProviderCredential,
  getProviderCredentialStatus,
  saveAnthropicCredential,
  saveOpenAICredential,
  saveProviderCredential,
} from "./credentials";
import {
  publicProviderConnectionPayload,
  toProviderConnectionSnapshot,
  type ProviderConnectionProvider,
  type ProviderConnectionSnapshot,
} from "./provider-connection-view";
import {
  OPENAI_OAUTH_FIXTURE_CODE,
  fixtureOpenAiOAuthTokens,
  isOpenAiOAuthFixtureCode,
} from "./provider-oauth-fixture";
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

export async function completeFixtureOpenAiOAuth(
  user: ConnectionUser,
  code = OPENAI_OAUTH_FIXTURE_CODE,
): Promise<ProviderConnectionSnapshot> {
  if (!isOpenAiOAuthFixtureCode(code)) {
    throw new Error("Use the CoDev fixture OAuth callback, not provider consent.");
  }
  const tokens = fixtureOpenAiOAuthTokens();
  await saveProviderCredential({
    scopeType: "USER",
    scopeId: user.id,
    provider: "openai",
    credentialType: "OAUTH_TOKEN",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    lastFour: tokens.lastFour,
  });
  return publicProviderConnectionPayload(
    await loadProviderConnectionSnapshot(user),
    tokens.accessToken,
  );
}

export async function revokePersonalProviderConnection(
  user: ConnectionUser,
  provider: ProviderConnectionProvider,
): Promise<ProviderConnectionSnapshot> {
  await deleteProviderCredential("USER", user.id, provider);
  return publicProviderConnectionPayload(
    await loadProviderConnectionSnapshot(user),
  );
}

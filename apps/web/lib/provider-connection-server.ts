import "server-only";

import { getProviderCredentialStatus } from "./credentials";
import {
  toProviderConnectionSnapshot,
  type ProviderConnectionSnapshot,
} from "./provider-connection-view";
import { displayMemberName } from "./shared-session-view";

export async function loadProviderConnectionSnapshot(user: {
  id: string;
  name?: string | null;
  githubLogin?: string;
}): Promise<ProviderConnectionSnapshot> {
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

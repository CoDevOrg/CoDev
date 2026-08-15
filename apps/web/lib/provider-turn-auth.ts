import type { AuthProvider } from "@codev/shared-types";

import { resolveAgentCredential, type ResolvedCredential } from "./credentials";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  bedrock: "Bedrock",
  azure_foundry: "Azure Foundry",
  cursor: "Cursor",
};

export class ProviderConnectionRequiredError extends Error {
  readonly status = 409;
  readonly code = "provider_connection_required";

  constructor(provider: string) {
    const label = PROVIDER_LABELS[provider] ?? provider;
    super(
      `This ${label} connection was revoked or is not connected. Reconnect a key in Settings before starting another turn. The existing session is unchanged.`,
    );
    this.name = "ProviderConnectionRequiredError";
  }
}

export function isProviderConnectionBlockMessage(
  value: string | null | undefined,
): boolean {
  return Boolean(value?.includes("connection was revoked or is not connected"));
}

export async function assertProviderConnectionForTurn(
  userId: string,
  workspaceId: string,
  provider: string,
): Promise<ResolvedCredential> {
  try {
    return await resolveAgentCredential(
      userId,
      workspaceId,
      provider as AuthProvider,
    );
  } catch {
    throw new ProviderConnectionRequiredError(provider);
  }
}

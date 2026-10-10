import { SUPPORTED_AI_PROVIDERS } from "./provider-logos";

export const providerName = (id: string) =>
  SUPPORTED_AI_PROVIDERS.find((provider) => provider.id === id)?.name ?? id;

/** How an agent is named wherever it appears: "Claude · Alex’s turn". */
export function agentLabel(provider: string, ownerName: string) {
  return `${providerName(provider)} · ${ownerName}’s turn`;
}

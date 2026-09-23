import type {
  Gen2ProviderCapabilities,
  Gen2ProviderDescriptor,
  Gen2ProviderId,
} from "@codev/contracts";

type ProviderDefinition = Gen2ProviderDescriptor;

const NO_EXECUTION: Gen2ProviderCapabilities = {
  canRun: false,
  canCancel: false,
  canStreamActivity: false,
  canUseWorkspaceTools: false,
};

/**
 * The complete Gen 2 provider vocabulary. A catalog entry does not promise
 * execution: `installed` becomes true only when its server-side adapter is
 * registered. This keeps future connection UI honest without coupling it to
 * the first implementation.
 */
export const gen2ProviderCatalog: readonly ProviderDefinition[] = [
  {
    id: "openai",
    label: "OpenAI",
    installed: true,
    capabilities: {
      canRun: true,
      canCancel: true,
      canStreamActivity: true,
      canUseWorkspaceTools: true,
    },
  },
  {
    id: "anthropic",
    label: "Anthropic",
    installed: false,
    capabilities: NO_EXECUTION,
  },
  {
    id: "cursor",
    label: "Cursor",
    installed: false,
    capabilities: NO_EXECUTION,
  },
];

export function getGen2ProviderDefinition(
  provider: Gen2ProviderId,
): ProviderDefinition {
  const definition = gen2ProviderCatalog.find((item) => item.id === provider);
  if (!definition) {
    throw new Error(`Unknown Gen 2 provider: ${provider}`);
  }
  return definition;
}

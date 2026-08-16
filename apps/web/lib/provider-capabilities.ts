export const RESTRICTED_FIXTURE_PROVIDER = "restricted";

export const QUEUE_UNAVAILABLE_EXPLANATION =
  "This restricted fixture provider does not support queued instructions.";
export const INTERRUPT_UNAVAILABLE_EXPLANATION =
  "This restricted fixture provider does not support interrupting a turn.";
export const PROVIDER_SWITCH_DURING_TURN_EXPLANATION =
  "A session keeps its provider for a turn. Interrupt or wait for the current turn to finish before switching.";

export type ProviderCapabilityAction =
  | "queue"
  | "interrupt"
  | "startControlled";

export type ProviderCapabilityFlags = {
  id: string;
  label: string;
  selected: boolean;
  canQueue: boolean;
  canInterrupt: boolean;
  canStartControlled: boolean;
  queueUnavailable: string | null;
  interruptUnavailable: string | null;
  startControlledUnavailable: string | null;
};

const OPENAI_CAPABILITIES: Omit<ProviderCapabilityFlags, "selected"> = {
  id: "openai",
  label: "OpenAI",
  canQueue: true,
  canInterrupt: true,
  canStartControlled: true,
  queueUnavailable: null,
  interruptUnavailable: null,
  startControlledUnavailable: null,
};

const RESTRICTED_CAPABILITIES: Omit<ProviderCapabilityFlags, "selected"> = {
  id: RESTRICTED_FIXTURE_PROVIDER,
  label: "Restricted fixture",
  canQueue: false,
  canInterrupt: false,
  canStartControlled: true,
  queueUnavailable: QUEUE_UNAVAILABLE_EXPLANATION,
  interruptUnavailable: INTERRUPT_UNAVAILABLE_EXPLANATION,
  startControlledUnavailable: null,
};

const PROVIDERS = [OPENAI_CAPABILITIES, RESTRICTED_CAPABILITIES] as const;

export function isSelectableSharedProvider(
  provider: string,
): provider is "openai" | typeof RESTRICTED_FIXTURE_PROVIDER {
  return provider === "openai" || provider === RESTRICTED_FIXTURE_PROVIDER;
}

export function isRestrictedFixtureProvider(provider: string) {
  return provider === RESTRICTED_FIXTURE_PROVIDER;
}

export function capabilitiesForProvider(
  provider: string,
  selected = true,
): ProviderCapabilityFlags {
  const match =
    PROVIDERS.find((item) => item.id === provider) ?? RESTRICTED_CAPABILITIES;
  return { ...match, selected };
}

export function listProviderCapabilities(
  selectedProvider: string,
): ProviderCapabilityFlags[] {
  return PROVIDERS.map((item) => ({
    ...item,
    selected: item.id === selectedProvider,
  }));
}

export const PROVIDER_BOUNDARY_EVENT_TYPE = "shared_session.provider.boundary";

export function providerSwitchLabel(from: string, to: string) {
  return `Provider boundary · switched from ${capabilitiesForProvider(from).label} to ${capabilitiesForProvider(to).label}`;
}

export function unavailableControlExplanation(
  provider: string,
  action: ProviderCapabilityAction,
): string | null {
  const capabilities = capabilitiesForProvider(provider);
  if (action === "queue" && !capabilities.canQueue) {
    return capabilities.queueUnavailable;
  }
  if (action === "interrupt" && !capabilities.canInterrupt) {
    return capabilities.interruptUnavailable;
  }
  if (action === "startControlled" && !capabilities.canStartControlled) {
    return capabilities.startControlledUnavailable;
  }
  return null;
}

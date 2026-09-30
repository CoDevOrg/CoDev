import {
  providerDefinition,
  type CredentialKind,
  type ExecutorSurface,
  type ProviderId,
} from "./registry";
import type {
  ProviderConnectionProvider,
  ProviderConnectionSnapshot,
} from "./provider-connection-view";

const PROVIDER_FOR_VENDOR: Record<ProviderConnectionProvider, ProviderId> = {
  openai: "codex",
  anthropic: "claude",
};

const VENDOR_SUBSCRIPTION: Record<
  ProviderConnectionProvider,
  "codex" | "claude"
> = { openai: "codex", anthropic: "claude" };

const SUBSCRIPTION_KIND: Record<ProviderId, CredentialKind> = {
  codex: "codex_auth_cache",
  claude: "claude_setup_token",
};

const SURFACES: readonly ExecutorSurface[] = ["gen2", "rooms"];

/** Settings labels follow the product navigation. */
export const SURFACE_LABEL: Record<ExecutorSurface, string> = {
  rooms: "Rooms",
  gen2: "Workspaces",
};

/** Active places where the member's connected provider can run. */
export function providerRunsIn(
  snapshot: ProviderConnectionSnapshot,
  vendor: ProviderConnectionProvider,
): ExecutorSurface[] {
  const provider = PROVIDER_FOR_VENDOR[vendor];
  const connected = new Set<CredentialKind>();
  const subscription = snapshot.cliSubscriptions.find(
    (row) => row.provider === VENDOR_SUBSCRIPTION[vendor],
  );
  if (subscription?.status === "connected") {
    connected.add(SUBSCRIPTION_KIND[provider]);
  }
  if (provider === "claude" && snapshot.claudeCliToken.status === "connected") {
    connected.add("claude_setup_token");
  }
  if (snapshot.connections.some((row) => row.provider === vendor && row.status === "connected")) {
    connected.add("api_key");
  }

  const kinds = providerDefinition(provider).kinds;
  return SURFACES.filter((surface) =>
    kinds.some((entry) => entry.runs[surface] && connected.has(entry.kind)),
  );
}

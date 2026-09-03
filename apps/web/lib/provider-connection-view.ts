export type ProviderConnectionProvider = "openai" | "anthropic" | "cursor";

export type ProviderConnectionStatus = "connected" | "not_connected";

export type ProviderConnectionCredentialType = "API_KEY" | "OAUTH_TOKEN";

export type ProviderConnectionRecord = {
  provider: ProviderConnectionProvider;
  label: string;
  status: ProviderConnectionStatus;
  credentialType: ProviderConnectionCredentialType | null;
  lastFour: string | null;
  suppliedBy: string | null;
  scope: "personal";
};

export type ProviderConnectionViewer = {
  id: string;
  name: string;
};

/**
 * The three agent accounts a member can sign into. Each one is reachable from
 * the settings page itself: Claude and Codex through their own OAuth flows,
 * Cursor through the `cursor-agent` browser deeplink. The CLI command is a
 * fallback for people who would rather stay in a terminal, not the only path.
 */
export type CliSubscriptionProvider = "codex" | "claude" | "cursor";

export type SubscriptionConnectMode =
  | "app_callback"
  | "manual_code"
  | "device_code"
  | "cursor_deeplink";

export type CliSubscriptionRecord = {
  provider: CliSubscriptionProvider;
  label: string;
  status: ProviderConnectionStatus;
  /** How the in-page Connect button drives this provider's sign-in. */
  connectMode: SubscriptionConnectMode;
  /** Terminal fallback, or null when the provider has no CoDev CLI command. */
  command: string | null;
};

const CLI_SUBSCRIPTIONS: Array<{
  provider: CliSubscriptionProvider;
  label: string;
  command: string | null;
  connectMode: SubscriptionConnectMode;
}> = [
  {
    provider: "codex",
    label: "Codex",
    command: "codev codex-auth",
    connectMode: "device_code",
  },
  {
    provider: "claude",
    label: "Claude Code",
    command: "codev claude-auth",
    connectMode: "manual_code",
  },
  {
    provider: "cursor",
    label: "Cursor",
    command: null,
    connectMode: "cursor_deeplink",
  },
];

export function toCliSubscriptionRecords(
  statuses: Partial<
    Record<CliSubscriptionProvider, ProviderCredentialStatus | null>
  >,
  connectModes: Partial<
    Record<CliSubscriptionProvider, SubscriptionConnectMode>
  > = {},
): CliSubscriptionRecord[] {
  return CLI_SUBSCRIPTIONS.map(({ provider, label, command, connectMode }) => ({
    provider,
    label,
    status: statuses[provider] ? "connected" : "not_connected",
    connectMode: connectModes[provider] ?? connectMode,
    command,
  }));
}

export type ProviderConnectionSnapshot = {
  viewer: ProviderConnectionViewer;
  connections: ProviderConnectionRecord[];
  cliSubscriptions: CliSubscriptionRecord[];
};

export type ProviderCredentialStatus = {
  credentialType?: string | null | undefined;
  lastFour?: string | null | undefined;
  encryptedApiKey?: string | null | undefined;
  encryptedAccessToken?: string | null | undefined;
  encryptedRefreshToken?: string | null | undefined;
  apiKey?: string | null | undefined;
  apiKeyOrToken?: string | null | undefined;
  accessToken?: string | null | undefined;
  refreshToken?: string | null | undefined;
};

const PROVIDERS: Array<{
  provider: ProviderConnectionProvider;
  label: string;
}> = [
  { provider: "openai", label: "OpenAI" },
  { provider: "anthropic", label: "Anthropic" },
  { provider: "cursor", label: "Cursor" },
];

const SECRET_KEYS = new Set([
  "encryptedApiKey",
  "encryptedAccessToken",
  "encryptedRefreshToken",
  "apiKey",
  "apiKeyOrToken",
  "accessToken",
  "refreshToken",
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
]);

export function isProviderConnectionProvider(
  value: string,
): value is ProviderConnectionProvider {
  return value === "openai" || value === "anthropic" || value === "cursor";
}

function publicCredentialType(
  value: string | null | undefined,
): ProviderConnectionCredentialType | null {
  if (value === "API_KEY" || value === "OAUTH_TOKEN") return value;
  return null;
}

export function toProviderConnectionRecord(input: {
  provider: ProviderConnectionProvider;
  label: string;
  status: ProviderCredentialStatus | null;
  suppliedBy: string;
}): ProviderConnectionRecord {
  const credentialType = publicCredentialType(input.status?.credentialType);
  const lastFour = input.status?.lastFour?.trim() || null;
  const connected = Boolean(input.status && credentialType);
  return {
    provider: input.provider,
    label: input.label,
    status: connected ? "connected" : "not_connected",
    credentialType: connected ? credentialType : null,
    lastFour: connected ? lastFour : null,
    suppliedBy: connected ? input.suppliedBy : null,
    scope: "personal",
  };
}

export function toProviderConnectionSnapshot(input: {
  viewer: ProviderConnectionViewer;
  statuses: Partial<
    Record<ProviderConnectionProvider, ProviderCredentialStatus | null>
  >;
  cliSubscriptionStatuses?: Partial<
    Record<CliSubscriptionProvider, ProviderCredentialStatus | null>
  >;
  connectModes?: Partial<
    Record<CliSubscriptionProvider, SubscriptionConnectMode>
  >;
}): ProviderConnectionSnapshot {
  const connections = PROVIDERS.map((provider) =>
    toProviderConnectionRecord({
      provider: provider.provider,
      label: provider.label,
      status: input.statuses[provider.provider] ?? null,
      suppliedBy: input.viewer.name,
    }),
  );
  return {
    viewer: input.viewer,
    connections,
    cliSubscriptions: toCliSubscriptionRecords(
      input.cliSubscriptionStatuses ?? {},
      input.connectModes ?? {},
    ),
  };
}

export function secretKeysInValue(
  value: unknown,
  found: string[] = [],
): string[] {
  if (!value || typeof value !== "object") return found;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) found.push(key);
    secretKeysInValue(nested, found);
  }
  return found;
}

export function publicProviderConnectionPayload<T>(
  value: T,
  submittedSecret?: string,
): T {
  if (secretKeysInValue(value).length > 0) {
    throw new Error("Provider connection responses must not include secrets.");
  }
  if (
    submittedSecret &&
    submittedSecret.length >= 8 &&
    JSON.stringify(value).includes(submittedSecret)
  ) {
    throw new Error(
      "Provider connection responses must not echo the submitted key.",
    );
  }
  return value;
}

export type ProviderConnectionProvider = "openai" | "anthropic";

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

export type ProviderOAuthPlanStatus = "unavailable" | "available";

export type ProviderOAuthPlan = {
  provider: "openai";
  status: ProviderOAuthPlanStatus;
  label: string;
  summary: string;
  reason: string;
};

export const OPENAI_OAUTH_PLAN: ProviderOAuthPlan = {
  provider: "openai",
  status: "available",
  label: "Connect with OpenAI",
  summary: "Fixture callback · ready",
  reason:
    "Connect uses a CoDev fixture callback. ChatGPT consent is not opened.",
};

export function toOpenAiOAuthPlan(
  status: ProviderCredentialStatus | null | undefined,
): ProviderOAuthPlan {
  if (publicCredentialType(status?.credentialType) === "OAUTH_TOKEN") {
    return {
      ...OPENAI_OAUTH_PLAN,
      summary: "Connected · fixture callback",
      reason:
        "OpenAI is connected through the CoDev fixture OAuth callback. ChatGPT consent was not used.",
    };
  }
  return OPENAI_OAUTH_PLAN;
}

export type ProviderConnectionSnapshot = {
  viewer: ProviderConnectionViewer;
  connections: ProviderConnectionRecord[];
  oauth: ProviderOAuthPlan;
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
  openAiOAuthStatus?: ProviderCredentialStatus | null;
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
    oauth: toOpenAiOAuthPlan(input.openAiOAuthStatus),
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

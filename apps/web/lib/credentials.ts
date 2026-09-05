import "server-only";

import { and, asc, eq, ne } from "drizzle-orm";

import { schema } from "@codev/db";
import {
  authProviderSchema,
  credentialScopeTypeSchema,
  credentialTypeSchema,
  type AuthProvider,
  type CredentialType,
  type ScopeType,
} from "@codev/shared-types";

import { decryptSecret, encryptSecret } from "./kms";
import { getDatabase } from "./database";
import {
  decryptHostedMaterial,
  resolveHostedCodexSubscription,
} from "./hosted-codex-subscription-credentials";

const FIVE_MINUTES_MS = 5 * 60 * 1_000;
const CREDENTIAL_CONTEXT = {
  application: "codev",
  purpose: "provider-credential",
};

export type CredentialSource = "USER" | "WORKSPACE" | "ORGANIZATION";

export interface ResolvedCredential {
  provider: AuthProvider;
  source: CredentialSource;
  authType: CredentialType;
  apiKeyOrToken?: string | undefined;
  endpointUrl?: string | undefined;
  awsRoleArn?: string | undefined;
  credentialId?: string | undefined;
  codexAuthCacheJson?: string | undefined;
}

type OAuthTokens = {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresAt?: Date | undefined;
};

function parseProvider(provider: AuthProvider) {
  return authProviderSchema.parse(provider);
}

function parseScopeType(scopeType: ScopeType) {
  return credentialScopeTypeSchema.parse(scopeType);
}

function parseCredentialType(credentialType: CredentialType) {
  return credentialTypeSchema.parse(credentialType);
}

function providerContext() {
  return CREDENTIAL_CONTEXT;
}

async function decryptCredentialSecret(encrypted: string) {
  try {
    return await decryptSecret(encrypted, providerContext());
  } catch (error) {
    // Existing credentials created by the in-progress KMS migration did not
    // bind an encryption context. Read them once without context so migration
    // remains non-disruptive; every new write uses the bound context above.
    try {
      return await decryptSecret(encrypted);
    } catch {
      throw error;
    }
  }
}

function byokRequiredError(provider: AuthProvider) {
  return new Error(
    `Connect a Codex, Claude, or Cursor credential in Settings before using ${provider} agents. CoDev does not provide platform AI keys.`,
  );
}

async function findCredential(
  scopeType: ScopeType,
  scopeId: string,
  provider: AuthProvider,
  credentialType?: CredentialType,
) {
  const predicates = [
    eq(schema.providerCredentials.scopeType, parseScopeType(scopeType)),
    eq(schema.providerCredentials.scopeId, scopeId),
    eq(schema.providerCredentials.provider, parseProvider(provider)),
    eq(schema.providerCredentials.isConnected, true),
  ];
  if (credentialType) {
    predicates.push(
      eq(
        schema.providerCredentials.credentialType,
        parseCredentialType(credentialType),
      ),
    );
  } else {
    predicates.push(
      ne(
        schema.providerCredentials.credentialType,
        "HOSTED_CODEX_SUBSCRIPTION",
      ),
    );
  }

  const [credential] = await getDatabase()
    .select()
    .from(schema.providerCredentials)
    .where(and(...predicates))
    .orderBy(asc(schema.providerCredentials.priorityOrder))
    .limit(1);
  return credential ?? null;
}

async function findCredentialSource(
  userId: string,
  workspaceId: string,
  provider: AuthProvider,
): Promise<CredentialSource> {
  const user = await findCredential("USER", userId, provider);
  if (user) return "USER";
  const workspace = await findCredential("WORKSPACE", workspaceId, provider);
  if (workspace) return "WORKSPACE";
  throw byokRequiredError(provider);
}

export async function getAgentKeySource(
  userId: string,
  workspaceId: string,
  provider: AuthProvider = "openai",
) {
  await findCredentialSource(userId, workspaceId, provider);
  return "byok" as const;
}

/**
 * The scope CoDev originally requests when it authorizes each provider —
 * duplicated from `getOAuthConfiguration` in `./oauth` (not imported: that
 * module imports `saveProviderCredential` from here, so importing it back
 * would cycle). Keep these two literals in sync if either changes.
 */
function oauthRefreshScope(provider: AuthProvider): string {
  return provider === "anthropic"
    ? process.env.CLAUDE_OAUTH_SCOPE?.trim() ||
        "org:create_api_key user:profile user:inference"
    : process.env.CODEX_OAUTH_SCOPE?.trim() ||
        "openid profile email offline_access";
}

async function refreshOAuthToken(
  provider: AuthProvider,
  refreshToken: string,
): Promise<OAuthTokens> {
  const configuration =
    provider === "anthropic"
      ? {
          tokenUrl:
            process.env.CLAUDE_OAUTH_TOKEN_URL ??
            "https://platform.claude.com/v1/oauth/token",
          clientId:
            process.env.CLAUDE_OAUTH_CLIENT_ID?.trim() ||
            "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
          clientSecret: process.env.CLAUDE_OAUTH_CLIENT_SECRET,
        }
      : {
          tokenUrl:
            process.env.CODEX_OAUTH_TOKEN_URL ??
            "https://auth.openai.com/oauth/token",
          clientId:
            process.env.CODEX_OAUTH_CLIENT_ID?.trim() ||
            "app_EMoamEEZ73f0CkXaXp7hrann",
          clientSecret: process.env.CODEX_OAUTH_CLIENT_SECRET,
        };

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    // Some OAuth servers narrow a refresh to a default scope set when the
    // request omits `scope`, instead of preserving the original grant (RFC
    // 6749 §6 only says the server SHOULD reuse it). That silently downgraded
    // a Claude connection here: the CLI kept "connected" but every inference
    // call 403'd with a scope error hours after the token's first refresh, no
    // reconnect prompt anywhere. Re-requesting the same scope avoids it.
    scope: oauthRefreshScope(provider),
  });
  if (configuration.clientId) body.set("client_id", configuration.clientId);
  if (configuration.clientSecret) {
    body.set("client_secret", configuration.clientSecret);
  }

  const response = await fetch(configuration.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `OAuth token refresh failed with status ${response.status}.`,
    );
  }
  const payload = (await response.json()) as Record<string, unknown>;
  if (typeof payload.access_token !== "string") {
    throw new Error("OAuth token refresh returned no access token.");
  }

  const expiresIn =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? payload.expires_in
      : undefined;
  return {
    accessToken: payload.access_token,
    refreshToken:
      typeof payload.refresh_token === "string"
        ? payload.refresh_token
        : undefined,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1_000) : undefined,
  };
}

async function updateRefreshedOAuthCredential(
  credentialId: string,
  tokens: OAuthTokens,
) {
  await getDatabase()
    .update(schema.providerCredentials)
    .set({
      encryptedAccessToken: await encryptSecret(
        tokens.accessToken,
        providerContext(),
      ),
      encryptedRefreshToken: tokens.refreshToken
        ? await encryptSecret(tokens.refreshToken, providerContext())
        : undefined,
      expiresAt: tokens.expiresAt,
      keyVersion: 2,
      updatedAt: new Date(),
    })
    .where(eq(schema.providerCredentials.id, credentialId));
}

async function getCredentialValue(
  credential: NonNullable<Awaited<ReturnType<typeof findCredential>>>,
): Promise<ResolvedCredential> {
  const provider = credential.provider as AuthProvider;
  const authType = credential.credentialType as CredentialType;

  if (authType === "AWS_BEDROCK_ROLE") {
    if (!credential.awsRoleArn) {
      throw new Error("The Bedrock credential is missing its IAM role ARN.");
    }
    return {
      provider,
      source: credential.scopeType,
      authType,
      awsRoleArn: credential.awsRoleArn,
      endpointUrl: credential.endpointUrl ?? undefined,
      credentialId: credential.id,
    };
  }

  if (authType === "AZURE_ENDPOINT" && !credential.endpointUrl) {
    throw new Error("The Azure Foundry credential is missing its endpoint.");
  }

  if (authType === "API_KEY" || authType === "AZURE_ENDPOINT") {
    if (!credential.encryptedApiKey) {
      throw new Error("The provider credential is missing its encrypted key.");
    }
    return {
      provider,
      source: credential.scopeType,
      authType,
      apiKeyOrToken: await decryptCredentialSecret(credential.encryptedApiKey),
      endpointUrl: credential.endpointUrl ?? undefined,
      credentialId: credential.id,
    };
  }

  if (!credential.encryptedAccessToken) {
    throw new Error("The OAuth credential is missing its encrypted token.");
  }

  const tokenExpiresAt = credential.expiresAt?.getTime();
  const shouldRefresh =
    tokenExpiresAt !== undefined &&
    tokenExpiresAt <= Date.now() + FIVE_MINUTES_MS;
  if (shouldRefresh && credential.encryptedRefreshToken) {
    const refreshToken = await decryptCredentialSecret(
      credential.encryptedRefreshToken,
    );
    const refreshed = await refreshOAuthToken(provider, refreshToken);
    await updateRefreshedOAuthCredential(credential.id, refreshed);
    return {
      provider,
      source: credential.scopeType,
      authType,
      apiKeyOrToken: refreshed.accessToken,
      endpointUrl: credential.endpointUrl ?? undefined,
      credentialId: credential.id,
    };
  }

  if (tokenExpiresAt !== undefined && tokenExpiresAt <= Date.now()) {
    throw new Error(
      "The OAuth credential has expired and cannot be refreshed.",
    );
  }

  return {
    provider,
    source: credential.scopeType,
    authType,
    apiKeyOrToken: await decryptCredentialSecret(
      credential.encryptedAccessToken,
    ),
    endpointUrl: credential.endpointUrl ?? undefined,
    credentialId: credential.id,
  };
}

export async function resolveAgentCredential(
  userId: string,
  workspaceId: string,
  provider: AuthProvider,
): Promise<ResolvedCredential> {
  const normalizedProvider = parseProvider(provider);
  if (normalizedProvider === "openai") {
    const hosted = await resolveHostedCodexSubscription({
      userId,
      workspaceId,
    });
    if (hosted) {
      if (!hosted.credential.encryptedMaterial) {
        throw new Error(
          "The Codex CLI connection has no encrypted auth cache.",
        );
      }
      const material = await decryptHostedMaterial(
        hosted.credential.encryptedMaterial,
      );
      if (!material.authCacheJson) {
        throw new Error(
          "Reconnect Codex with `codev codex-auth`; the stored connection uses an obsolete format.",
        );
      }
      return {
        provider: normalizedProvider,
        source: hosted.source,
        authType: "HOSTED_CODEX_SUBSCRIPTION",
        codexAuthCacheJson: material.authCacheJson,
        credentialId: hosted.credential.id,
      };
    }
  }
  const userCredential = await findCredential(
    "USER",
    userId,
    normalizedProvider,
  );
  if (userCredential) return getCredentialValue(userCredential);

  const workspaceCredential = await findCredential(
    "WORKSPACE",
    workspaceId,
    normalizedProvider,
  );
  if (workspaceCredential) return getCredentialValue(workspaceCredential);

  throw byokRequiredError(normalizedProvider);
}

/**
 * The Cursor CLI login token pair, for materializing `cursor-agent`'s own
 * `auth.json` on a workspace host. Personal scope wins over workspace scope,
 * matching resolveAgentCredential. Returns null when no Cursor login is
 * connected — callers fall back to a pasted `CURSOR_API_KEY`.
 */
export async function resolveCursorCliAuth(
  userId: string,
  workspaceId: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const credential =
    (await findCredential("USER", userId, "cursor")) ??
    (await findCredential("WORKSPACE", workspaceId, "cursor"));
  if (
    !credential ||
    credential.credentialType !== "OAUTH_TOKEN" ||
    !credential.encryptedAccessToken ||
    !credential.encryptedRefreshToken
  ) {
    return null;
  }
  return {
    accessToken: await decryptCredentialSecret(credential.encryptedAccessToken),
    refreshToken: await decryptCredentialSecret(
      credential.encryptedRefreshToken,
    ),
  };
}

/**
 * Whether this member (or the workspace) has any connected Cursor
 * credential — an OAuth login or a pasted API key. A presence check only, no
 * decryption: callers that need the secret itself use `resolveCursorCliAuth`
 * or `resolveAgentCredential`. Used to decide whether the IDE's in-chat
 * provider switcher may offer Cursor at all, since unlike Claude/Codex it has
 * no host-injected fallback and would otherwise strand an unlinked member on
 * cursor-agent's own sign-in wall.
 */
export async function hasLinkedCursorCredential(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const credential =
    (await findCredential("USER", userId, "cursor")) ??
    (await findCredential("WORKSPACE", workspaceId, "cursor"));
  return credential != null;
}

export async function saveProviderCredential(input: {
  scopeType: ScopeType;
  scopeId: string;
  provider: AuthProvider;
  credentialType: CredentialType;
  apiKey?: string | undefined;
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  expiresAt?: Date | undefined;
  endpointUrl?: string | undefined;
  awsRoleArn?: string | undefined;
  priorityOrder?: number | undefined;
  lastFour?: string | undefined;
}) {
  const scopeType = parseScopeType(input.scopeType);
  const provider = parseProvider(input.provider);
  const credentialType = parseCredentialType(input.credentialType);

  if (credentialType === "HOSTED_CODEX_SUBSCRIPTION") {
    throw new Error(
      "Hosted Codex subscription credentials must be saved by the hosted connection service.",
    );
  }
  if (credentialType === "API_KEY" && !input.apiKey?.trim()) {
    throw new Error("An API key is required for this credential type.");
  }
  if (credentialType === "OAUTH_TOKEN" && !input.accessToken?.trim()) {
    throw new Error(
      "An OAuth access token is required for this credential type.",
    );
  }
  if (credentialType === "AWS_BEDROCK_ROLE" && !input.awsRoleArn?.trim()) {
    throw new Error(
      "An AWS Bedrock role ARN is required for this credential type.",
    );
  }
  if (
    credentialType === "AZURE_ENDPOINT" &&
    (!input.apiKey?.trim() || !input.endpointUrl?.trim())
  ) {
    throw new Error(
      "An Azure endpoint and API key are required for this credential type.",
    );
  }

  const encryptedApiKey = input.apiKey?.trim()
    ? await encryptSecret(input.apiKey.trim(), providerContext())
    : null;
  const encryptedAccessToken = input.accessToken?.trim()
    ? await encryptSecret(input.accessToken.trim(), providerContext())
    : null;
  const encryptedRefreshToken = input.refreshToken?.trim()
    ? await encryptSecret(input.refreshToken.trim(), providerContext())
    : null;

  await getDatabase()
    .insert(schema.providerCredentials)
    .values({
      scopeType,
      scopeId: input.scopeId,
      provider,
      credentialType,
      priorityOrder: input.priorityOrder ?? 0,
      encryptedApiKey,
      encryptedAccessToken,
      encryptedRefreshToken,
      expiresAt: input.expiresAt,
      endpointUrl: input.endpointUrl,
      awsRoleArn: input.awsRoleArn,
      isConnected: true,
      keyVersion: 2,
      lastFour: input.lastFour ?? null,
    })
    .onConflictDoUpdate({
      target: [
        schema.providerCredentials.scopeType,
        schema.providerCredentials.scopeId,
        schema.providerCredentials.provider,
        schema.providerCredentials.credentialType,
      ],
      set: {
        priorityOrder: input.priorityOrder ?? 0,
        encryptedApiKey,
        encryptedAccessToken,
        encryptedRefreshToken,
        expiresAt: input.expiresAt,
        endpointUrl: input.endpointUrl,
        awsRoleArn: input.awsRoleArn,
        isConnected: true,
        keyVersion: 2,
        lastFour: input.lastFour ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function saveOpenAICredential(userId: string, apiKey: string) {
  const normalized = apiKey.trim();
  if (!normalized.startsWith("sk-") || normalized.length < 20) {
    throw new Error("Enter a valid OpenAI API key.");
  }
  await saveProviderCredential({
    scopeType: "USER",
    scopeId: userId,
    provider: "openai",
    credentialType: "API_KEY",
    apiKey: normalized,
    lastFour: normalized.slice(-4),
  });
}

export async function saveAnthropicCredential(userId: string, apiKey: string) {
  const normalized = apiKey.trim();
  if (!normalized.startsWith("sk-ant-") || normalized.length < 20) {
    throw new Error("Enter a valid Anthropic API key.");
  }
  await saveProviderCredential({
    scopeType: "USER",
    scopeId: userId,
    provider: "anthropic",
    credentialType: "API_KEY",
    apiKey: normalized,
    lastFour: normalized.slice(-4),
  });
}

export async function saveCursorCredential(userId: string, apiKey: string) {
  const normalized = apiKey.trim();
  if (normalized.length < 20) {
    throw new Error("Enter a valid Cursor API key.");
  }
  await saveProviderCredential({
    scopeType: "USER",
    scopeId: userId,
    provider: "cursor",
    credentialType: "API_KEY",
    apiKey: normalized,
    lastFour: normalized.slice(-4),
  });
}

export async function getProviderCredentialStatus(
  scopeType: ScopeType,
  scopeId: string,
  provider: AuthProvider,
  credentialType?: CredentialType,
) {
  const credential = await findCredential(
    scopeType,
    scopeId,
    provider,
    credentialType,
  );
  return credential
    ? {
        credentialType: credential.credentialType as CredentialType,
        lastFour: credential.lastFour ?? undefined,
        endpointUrl: credential.endpointUrl ?? undefined,
        awsRoleArn: credential.awsRoleArn ?? undefined,
        updatedAt: credential.updatedAt,
      }
    : null;
}

export async function getOAuthCredentialStatus(
  scopeType: ScopeType,
  scopeId: string,
  provider: AuthProvider,
) {
  return getProviderCredentialStatus(
    scopeType,
    scopeId,
    provider,
    "OAUTH_TOKEN",
  );
}

export async function deleteProviderCredential(
  scopeType: ScopeType,
  scopeId: string,
  provider: AuthProvider,
  credentialType?: CredentialType,
) {
  const predicates = [
    eq(schema.providerCredentials.scopeType, parseScopeType(scopeType)),
    eq(schema.providerCredentials.scopeId, scopeId),
    eq(schema.providerCredentials.provider, parseProvider(provider)),
  ];
  if (credentialType) {
    predicates.push(
      eq(
        schema.providerCredentials.credentialType,
        parseCredentialType(credentialType),
      ),
    );
  } else {
    predicates.push(
      ne(
        schema.providerCredentials.credentialType,
        "HOSTED_CODEX_SUBSCRIPTION",
      ),
    );
  }
  await getDatabase()
    .delete(schema.providerCredentials)
    .where(and(...predicates));
}

export async function getOpenAICredentialStatus(userId: string) {
  const credential = await findCredential("USER", userId, "openai", "API_KEY");
  return credential
    ? {
        lastFour: credential.lastFour ?? undefined,
        updatedAt: credential.updatedAt,
      }
    : null;
}

export async function getOpenAIApiKey(userId: string) {
  const credential = await findCredential("USER", userId, "openai", "API_KEY");
  if (!credential || !credential.encryptedApiKey) {
    throw new Error(
      "Add an OpenAI API key in Settings before starting an agent turn.",
    );
  }
  return decryptCredentialSecret(credential.encryptedApiKey);
}

export async function getOpenAIApiKeyForAgent(
  userId: string,
  workspaceId?: string,
) {
  if (workspaceId) {
    const resolved = await resolveAgentCredential(
      userId,
      workspaceId,
      "openai",
    );
    if (!resolved.apiKeyOrToken) {
      throw new Error("The selected OpenAI credential has no bearer token.");
    }
    return {
      apiKey: resolved.apiKeyOrToken,
      source: "byok" as const,
    };
  }

  const credential = await getOpenAICredentialStatus(userId);
  if (!credential) {
    throw byokRequiredError("openai");
  }
  return { apiKey: await getOpenAIApiKey(userId), source: "byok" as const };
}

export async function deleteOpenAICredential(userId: string) {
  await getDatabase()
    .delete(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.scopeType, "USER"),
        eq(schema.providerCredentials.scopeId, userId),
        eq(schema.providerCredentials.provider, "openai"),
        eq(schema.providerCredentials.credentialType, "API_KEY"),
      ),
    );
}

export { refreshOAuthToken };

import "server-only";

import { and, asc, eq, isNotNull, ne } from "drizzle-orm";

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
import {
  defaultSharingEnabled,
  resolvePersonalOrSharedCredential,
} from "./scoped-credential-sharing";
import {
  CLAUDE_CLI_TOKEN_KIND,
  type ClaudeCliTokenPublicStatus,
} from "./claude-cli-token-view";

const FIVE_MINUTES_MS = 5 * 60 * 1_000;
const CREDENTIAL_CONTEXT = {
  application: "codev",
  purpose: "provider-credential",
};

export type CredentialSource = "USER" | "WORKSPACE" | "ORGANIZATION";

export interface ResolvedCredential {
  provider: AuthProvider;
  source: CredentialSource;
  authType: CredentialType | "CLAUDE_RUNTIME";
  claudeUserId?: string;
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

/** The two product surfaces a credential can be enabled for. */
export type CredentialSurface = "rooms" | "workspace";

/**
 * Predicates limiting a lookup to credentials usable on one surface. A coding
 * workspace runs on a shared host, so it never sees a browser subscription —
 * nor an unstamped legacy row, which is treated as browser by the migration.
 * Rooms accept any provenance the member has enabled there.
 */
function surfacePredicates(surface: CredentialSurface | undefined) {
  if (!surface) return [];
  if (surface === "rooms") {
    return [eq(schema.providerCredentials.enabledForRooms, true)];
  }
  return [
    eq(schema.providerCredentials.enabledForWorkspace, true),
    isNotNull(schema.providerCredentials.connectedVia),
    ne(schema.providerCredentials.connectedVia, "browser"),
  ];
}

async function findCredential(
  scopeType: ScopeType,
  scopeId: string,
  provider: AuthProvider,
  credentialType?: CredentialType,
  surface?: CredentialSurface,
) {
  const predicates = [
    eq(schema.providerCredentials.scopeType, parseScopeType(scopeType)),
    eq(schema.providerCredentials.scopeId, scopeId),
    eq(schema.providerCredentials.provider, parseProvider(provider)),
    eq(schema.providerCredentials.isConnected, true),
    ...surfacePredicates(surface),
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
  if (provider === "anthropic" && authType === "OAUTH_TOKEN") {
    throw new Error(
      "Reconnect Claude using official runtime login. Subscription tokens can no longer be used through the API.",
    );
  }

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

/**
 * Resolve only the sender's subscription for a chat room; never fall back to
 * an API key or shared seat. Rooms are the one surface a browser subscription
 * may power, so any provenance is accepted — but only if the member left the
 * credential enabled for rooms (the Claude browser runtime lives outside
 * provider_credentials and is inherently rooms-only, so it carries no flag).
 */
export async function resolvePersonalChatSubscription(
  userId: string,
  provider: "claude" | "codex",
): Promise<ResolvedCredential> {
  if (provider === "claude") {
    const { getConnectedClaudeRuntime } =
      await import("./claude-connection-session");
    const connection = await getConnectedClaudeRuntime(userId);
    if (!connection)
      throw new Error("Reconnect Claude using official login in Settings.");
    return {
      provider: "anthropic",
      source: "USER",
      authType: "CLAUDE_RUNTIME",
      credentialId: connection.id,
      claudeUserId: userId,
    };
  }
  if (provider === "codex") {
    const hosted = await resolveHostedCodexSubscription({
      userId,
      includeBusy: true,
    });
    if (
      hosted?.credential.encryptedMaterial &&
      hosted.credential.enabledForRooms !== false
    ) {
      const material = await decryptHostedMaterial(
        hosted.credential.encryptedMaterial,
      );
      if (material.authCacheJson)
        return {
          provider: "openai",
          source: "USER",
          authType: "HOSTED_CODEX_SUBSCRIPTION",
          credentialId: hosted.credential.id,
          codexAuthCacheJson: material.authCacheJson,
        };
    }
  }
  const credential = await findCredential(
    "USER",
    userId,
    "openai",
    "OAUTH_TOKEN",
    "rooms",
  );
  if (!credential || credential.status !== "active")
    throw new Error(
      "Connect your subscription in Settings before asking for a reply.",
    );
  return getCredentialValue(credential);
}

export async function resolveAgentCredential(
  userId: string,
  workspaceId: string,
  provider: AuthProvider,
): Promise<ResolvedCredential> {
  const normalizedProvider = parseProvider(provider);
  if (normalizedProvider === "anthropic") {
    const { getConnectedClaudeRuntime } =
      await import("./claude-connection-session");
    const connection = await getConnectedClaudeRuntime(userId);
    if (connection)
      return {
        provider: "anthropic",
        source: "USER",
        authType: "CLAUDE_RUNTIME",
        credentialId: connection.id,
        claudeUserId: userId,
      };
  }
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
  surface?: CredentialSurface,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const credential =
    (await findCredential("USER", userId, "cursor", "OAUTH_TOKEN", surface)) ??
    (await findCredential(
      "WORKSPACE",
      workspaceId,
      "cursor",
      "OAUTH_TOKEN",
      surface,
    ));
  if (
    !credential ||
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

/**
 * A pasted API key the member enabled for coding workspaces, for the host env.
 * Personal scope wins over workspace scope, matching resolveAgentCredential.
 * Read directly rather than via resolveAgentCredential, which prefers a
 * subscription — a workspace must never receive a browser subscription.
 */
export async function resolveWorkspaceApiKey(
  userId: string,
  workspaceId: string,
  provider: AuthProvider,
): Promise<string | null> {
  const credential =
    (await findCredential("USER", userId, provider, "API_KEY", "workspace")) ??
    (await findCredential(
      "WORKSPACE",
      workspaceId,
      provider,
      "API_KEY",
      "workspace",
    ));
  if (!credential?.encryptedApiKey) return null;
  return decryptCredentialSecret(credential.encryptedApiKey);
}

/**
 * The `claude setup-token` a member uploaded with `codev claude-auth`, for the
 * workspace host's CLAUDE_CODE_OAUTH_TOKEN. Deliberately not routed through
 * getCredentialValue, which rejects Anthropic OAuth tokens so they can never
 * become a direct-API bearer — this host-only reader is the one legitimate
 * consumer. The member's own token wins; otherwise the workspace's shared
 * token (`codev claude-auth --org`), the same personal-or-shared rule Codex
 * uses — see `resolvePersonalOrSharedCredential`.
 */
type ProviderCredentialRow = NonNullable<
  Awaited<ReturnType<typeof findCredential>>
>;

export async function resolveClaudeCliTokenForIde(
  userId: string,
  workspaceId?: string,
): Promise<string | null> {
  const findCliToken = async (
    scopeType: ScopeType,
    scopeId: string,
  ): Promise<ProviderCredentialRow | null> => {
    const credential = await findCredential(
      scopeType,
      scopeId,
      "anthropic",
      "OAUTH_TOKEN",
      "workspace",
    );
    return credential?.connectedVia === "cli" ? credential : null;
  };
  const result = await resolvePersonalOrSharedCredential<ProviderCredentialRow>(
    { userId, workspaceId },
    {
      findPersonal: (id) => findCliToken("USER", id),
      findShared: (id) => findCliToken("ORGANIZATION", id),
    },
  );
  if (!result?.credential.encryptedAccessToken) return null;
  return decryptCredentialSecret(result.credential.encryptedAccessToken);
}

/** How a credential was obtained; mirrors `credentialConnectedVia` in the schema. */
export type CredentialConnectedVia = "browser" | "cli" | "api_key";

/** Which product surfaces a credential is enabled for (isolation + opt-in sharing). */
export type CredentialSurfaces = { rooms: boolean; workspace: boolean };

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
  /** Provenance. Key-like types default to `api_key`; an OAuth token defaults
   *  to `browser` (rooms-only), the conservative choice for a flow that did not
   *  declare itself. */
  connectedVia?: CredentialConnectedVia | undefined;
  /** Surfaces to enable on create. Defaults to both; on reconnect the member's
   *  existing toggles are preserved unless this is given. */
  enabledFor?: CredentialSurfaces | undefined;
  /** Whether every member of the scope (an ORGANIZATION credential's scope id
   *  is a specific workspace) may use this login, not just whoever connected
   *  it. Defaults to true for ORGANIZATION scope, false for USER — the same
   *  rule `persistHostedCodexConnection` applies for Codex. */
  sharingEnabled?: boolean | undefined;
}) {
  const scopeType = parseScopeType(input.scopeType);
  const provider = parseProvider(input.provider);
  const credentialType = parseCredentialType(input.credentialType);
  const connectedVia: CredentialConnectedVia =
    input.connectedVia ??
    (credentialType === "OAUTH_TOKEN" ? "browser" : "api_key");
  const sharingEnabled =
    input.sharingEnabled ?? defaultSharingEnabled(scopeType);

  // A consumer Claude OAuth token must never be used as a direct-API bearer, so
  // the browser-era token flow stays retired. The one exception is the local
  // CLI's `claude setup-token`: Anthropic's long-lived token whose intended use
  // is CLAUDE_CODE_OAUTH_TOKEN on a host. Only the workspace-host resolver reads
  // it (resolveClaudeCliTokenForIde); getCredentialValue still rejects it.
  if (
    provider === "anthropic" &&
    credentialType === "OAUTH_TOKEN" &&
    connectedVia !== "cli"
  ) {
    throw new Error(
      "Token-based Claude connections are retired. Reconnect using official Claude login in Settings.",
    );
  }

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
      connectedVia,
      sharingEnabled,
      enabledForRooms: input.enabledFor?.rooms ?? true,
      enabledForWorkspace: input.enabledFor?.workspace ?? true,
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
        connectedVia,
        ...(input.sharingEnabled !== undefined ? { sharingEnabled } : {}),
        ...(input.enabledFor
          ? {
              enabledForRooms: input.enabledFor.rooms,
              enabledForWorkspace: input.enabledFor.workspace,
            }
          : {}),
        updatedAt: new Date(),
      },
    });
}

export async function saveOpenAICredential(
  userId: string,
  apiKey: string,
  enabledFor?: CredentialSurfaces,
) {
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
    enabledFor,
  });
}

export async function saveAnthropicCredential(
  userId: string,
  apiKey: string,
  enabledFor?: CredentialSurfaces,
) {
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
    enabledFor,
  });
}

export async function saveCursorCredential(
  userId: string,
  apiKey: string,
  enabledFor?: CredentialSurfaces,
) {
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
    enabledFor,
  });
}

/**
 * Flip which surfaces a stored credential is enabled for. This records the
 * member's intent only: workspace *eligibility* (never a browser login) is
 * enforced by the resolvers regardless, so enabling a browser subscription for
 * workspaces here would be a no-op — the settings UI disables that toggle and
 * says why.
 */
export async function updateCredentialSurfaces(
  scopeType: ScopeType,
  scopeId: string,
  provider: AuthProvider,
  credentialType: CredentialType,
  surfaces: Partial<CredentialSurfaces>,
) {
  await getDatabase()
    .update(schema.providerCredentials)
    .set({
      ...(surfaces.rooms !== undefined
        ? { enabledForRooms: surfaces.rooms }
        : {}),
      ...(surfaces.workspace !== undefined
        ? { enabledForWorkspace: surfaces.workspace }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.providerCredentials.scopeType, parseScopeType(scopeType)),
        eq(schema.providerCredentials.scopeId, scopeId),
        eq(schema.providerCredentials.provider, parseProvider(provider)),
        eq(
          schema.providerCredentials.credentialType,
          parseCredentialType(credentialType),
        ),
      ),
    );
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
  if (!credential) return null;
  // A browser-era Claude token is retired; only a CLI setup-token (stamped
  // `cli` by persistClaudeOAuthToken) counts as a live connection.
  if (
    provider === "anthropic" &&
    credential.credentialType === "OAUTH_TOKEN" &&
    credential.connectedVia !== "cli"
  ) {
    return null;
  }
  return {
    credentialType: credential.credentialType as CredentialType,
    lastFour: credential.lastFour ?? undefined,
    endpointUrl: credential.endpointUrl ?? undefined,
    awsRoleArn: credential.awsRoleArn ?? undefined,
    updatedAt: credential.updatedAt,
    connectedVia: credential.connectedVia ?? undefined,
    enabledForRooms: credential.enabledForRooms,
    enabledForWorkspace: credential.enabledForWorkspace,
    sharingEnabled: credential.sharingEnabled,
  };
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

/**
 * The `codev claude-auth` setup-token's status for a settings card — mirrors
 * `getHostedCodexPublicStatus` (`hosted-codex-subscription-credentials.ts`) so
 * Claude and Codex present org-sharing the same way. `getProviderCredentialStatus`
 * already excludes a non-`cli` (browser-era) Claude token, so `connected` here
 * means exactly "this scope's workspace host can use this token".
 */
export async function getClaudeCliTokenPublicStatus(input: {
  scopeType: "USER" | "ORGANIZATION";
  scopeId: string;
  canManage: boolean;
}): Promise<ClaudeCliTokenPublicStatus> {
  const status = await getProviderCredentialStatus(
    input.scopeType,
    input.scopeId,
    "anthropic",
    "OAUTH_TOKEN",
  );
  const connected = Boolean(status);
  return {
    kind: CLAUDE_CLI_TOKEN_KIND,
    scopeType: input.scopeType,
    status: connected ? "connected" : "not_connected",
    stateText: connected
      ? input.scopeType === "ORGANIZATION"
        ? "Connected for this workspace"
        : "Connected · codev claude-auth"
      : "Not connected",
    lastFour: connected ? (status?.lastFour ?? null) : null,
    sharingEnabled: Boolean(status?.sharingEnabled),
    canManage: input.canManage,
  };
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

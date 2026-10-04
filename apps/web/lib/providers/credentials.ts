import "server-only";

import { and, asc, eq, ne } from "drizzle-orm";

import { schema } from "@codev/db";
import {
  authProviderSchema,
  credentialTypeSchema,
  type AuthProvider,
  type CredentialType,
} from "@codev/shared-types";

import { decryptSecret, encryptSecret } from "../platform/kms";
import { getDatabase } from "../platform/database";

const CREDENTIAL_CONTEXT = {
  application: "codev",
  purpose: "provider-credential",
};

export type CredentialSource = "USER";

export interface ResolvedCredential {
  provider: AuthProvider;
  source: CredentialSource;
  authType: CredentialType | "CLAUDE_RUNTIME";
  claudeUserId?: string;
  /** The `claude setup-token` a Claude turn authenticates with. */
  claudeSetupToken?: string | undefined;
  apiKeyOrToken?: string | undefined;
  endpointUrl?: string | undefined;
  awsRoleArn?: string | undefined;
  credentialId?: string | undefined;
  codexAuthCacheJson?: string | undefined;
}

function parseProvider(provider: AuthProvider) {
  return authProviderSchema.parse(provider);
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

async function findCredential(
  userId: string,
  provider: AuthProvider,
  credentialType?: CredentialType,
) {
  const predicates = [
    eq(schema.providerCredentials.scopeType, "USER"),
    eq(schema.providerCredentials.scopeId, userId),
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

/**
 * Resolve the credential a chat-room reply runs on.
 *
 * The walk itself now lives in `resolveCredential`; this keeps the
 * `ResolvedCredential` shape the rooms executor consumes. Rooms pass no
 * workspace id, so a shared seat can never fund a reply, and the registry —
 * not a flag on the row — decides that rooms run the two subscription forms
 * and not an API key.
 */
export async function resolvePersonalChatSubscription(
  userId: string,
  provider: "claude" | "codex",
): Promise<ResolvedCredential> {
  const { requireCredential } = await import("./resolve");
  const resolved = await requireCredential({
    userId,
    provider,
    surface: "rooms",
  });
  if (resolved.secret.kind === "claude_setup_token") {
    return {
      provider: "anthropic",
      source: "USER",
      authType: "CLAUDE_RUNTIME",
      ...(resolved.credentialId ? { credentialId: resolved.credentialId } : {}),
      claudeUserId: userId,
      claudeSetupToken: resolved.secret.token,
    };
  }
  if (resolved.secret.kind === "codex_auth_cache") {
    return {
      provider: "openai",
      source: "USER",
      authType: "HOSTED_CODEX_SUBSCRIPTION",
      ...(resolved.credentialId ? { credentialId: resolved.credentialId } : {}),
      codexAuthCacheJson: resolved.secret.authCacheJson,
    };
  }
  // The registry lists no other kind as rooms-capable; a new one must decide
  // how the rooms executor consumes it rather than falling through silently.
  throw new Error(
    "This connection cannot answer in chat rooms. Connect a subscription in Settings.",
  );
}

/** How a credential was obtained; mirrors `credentialConnectedVia` in the schema. */
export type CredentialConnectedVia = "browser" | "cli" | "api_key";

export async function saveProviderCredential(input: {
  userId: string;
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
  /** Provenance. Key-like types default to `api_key`; OAuth defaults to `browser`. */
  connectedVia?: CredentialConnectedVia | undefined;
  /** Whether this credential may fund a turn in a shared workspace.
   *  Defaults to true on create; preserved on reconnect unless given. */
  allowInSharedWorkspaces?: boolean | undefined;
}) {
  const provider = parseProvider(input.provider);
  const credentialType = parseCredentialType(input.credentialType);
  const connectedVia: CredentialConnectedVia =
    input.connectedVia ??
    (credentialType === "OAUTH_TOKEN" ? "browser" : "api_key");

  // A consumer Claude OAuth token must never be used as a direct-API bearer.
  // The only anthropic OAUTH_TOKEN CoDev stores is a `claude setup-token`,
  // whose intended use is CLAUDE_CODE_OAUTH_TOKEN on a host — and both
  // sign-ins produce one now, the CLI upload and the browser login that
  // captures what the CLI printed. `connectedVia` therefore records how it
  // arrived, not whether it may be stored; the browser-era exchange that
  // this guard was written against no longer has a route at all.
  if (
    provider === "anthropic" &&
    credentialType === "OAUTH_TOKEN" &&
    connectedVia === "api_key"
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
      scopeType: "USER",
      scopeId: input.userId,
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
      allowInSharedWorkspaces: input.allowInSharedWorkspaces ?? true,
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
        ...(input.allowInSharedWorkspaces !== undefined
          ? { allowInSharedWorkspaces: input.allowInSharedWorkspaces }
          : {}),
        updatedAt: new Date(),
      },
    });
}

export async function saveOpenAICredential(
  userId: string,
  apiKey: string,
  allowInSharedWorkspaces?: boolean,
) {
  const normalized = apiKey.trim();
  if (!normalized.startsWith("sk-") || normalized.length < 20) {
    throw new Error("Enter a valid OpenAI API key.");
  }
  await saveProviderCredential({
    userId,
    provider: "openai",
    credentialType: "API_KEY",
    apiKey: normalized,
    lastFour: normalized.slice(-4),
    allowInSharedWorkspaces,
  });
}

export async function saveAnthropicCredential(
  userId: string,
  apiKey: string,
  allowInSharedWorkspaces?: boolean,
) {
  const normalized = apiKey.trim();
  if (!normalized.startsWith("sk-ant-") || normalized.length < 20) {
    throw new Error("Enter a valid Anthropic API key.");
  }
  await saveProviderCredential({
    userId,
    provider: "anthropic",
    credentialType: "API_KEY",
    apiKey: normalized,
    lastFour: normalized.slice(-4),
    allowInSharedWorkspaces,
  });
}

/**
 * Flip whether a stored credential may fund a turn inside a shared
 * workspace. Unlike the two per-surface flags this replaced, it is read on
 * every resolution path, so it is a real setting rather than a badge.
 */
export async function updateCredentialSharedWorkspacePermission(
  userId: string,
  provider: AuthProvider,
  credentialType: CredentialType,
  allowInSharedWorkspaces: boolean,
) {
  await getDatabase()
    .update(schema.providerCredentials)
    .set({
      allowInSharedWorkspaces,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.providerCredentials.scopeType, "USER"),
        eq(schema.providerCredentials.scopeId, userId),
        eq(schema.providerCredentials.provider, parseProvider(provider)),
        eq(
          schema.providerCredentials.credentialType,
          parseCredentialType(credentialType),
        ),
      ),
    );
}

export async function getProviderCredentialStatus(
  userId: string,
  provider: AuthProvider,
  credentialType?: CredentialType,
) {
  const credential = await findCredential(userId, provider, credentialType);
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
    allowInSharedWorkspaces: credential.allowInSharedWorkspaces,
  };
}

export async function deleteProviderCredential(
  userId: string,
  provider: AuthProvider,
  credentialType?: CredentialType,
) {
  const predicates = [
    eq(schema.providerCredentials.scopeType, "USER"),
    eq(schema.providerCredentials.scopeId, userId),
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
  const database = getDatabase();
  const credentials = await database
    .select({ id: schema.providerCredentials.id })
    .from(schema.providerCredentials)
    .where(and(...predicates));
  const { revokeGen2SupersetCredentialRuns } =
    await import("../gen2/superset-agent-runtime");
  await Promise.all(
    credentials.map((credential) =>
      revokeGen2SupersetCredentialRuns(credential.id),
    ),
  );
  await database.delete(schema.providerCredentials).where(and(...predicates));
}

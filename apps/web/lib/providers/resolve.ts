import "server-only";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { decryptSecret } from "../platform/kms";
import {
  decryptHostedMaterial,
  resolveHostedCodexSubscription,
} from "./hosted-codex-subscription-credentials";
import {
  EXECUTOR_SURFACES,
  PROVIDER_IDS,
  providerDefinition,
  providerVendor,
  runnableKinds,
  type CredentialKind,
  type ExecutorSurface,
  type ProviderId,
  type ResolvedSecret,
} from "./registry";
import { belongsToSharedScope } from "./scoped-credential-sharing";

/**
 * The one credential resolver.
 *
 * It replaced three that disagreed: `resolveAgentCredential` (Gen 1),
 * `resolvePersonalChatSubscription` (rooms), and `resolveGen2Credential` (Gen 2) —
 * none of which consulted the capability table the settings page rendered
 * from. Readiness is now literally this function with `dryRun`, so what a
 * member is told and what the executor does cannot drift.
 *
 * Resolution order is the provider's own kind order from the registry,
 * filtered to the kinds the target executor can run.
 */

export type ResolveInput = {
  userId: string;
  provider: ProviderId;
  surface: ExecutorSurface;
  /** Enables the workspace's shared login as a fallback, and is required for
   *  any shared lookup. Membership is verified before a shared row is used. */
  workspaceId?: string | undefined;
  /** Skip decryption — for readiness, which needs only "would this work". */
  dryRun?: boolean | undefined;
};

export type CredentialSource = "personal" | "shared";

export type ResolvedCredentialRecord = {
  ok: true;
  provider: ProviderId;
  kind: CredentialKind;
  source: CredentialSource;
  /** Null for a credential with no row to lease (the browser runtime). */
  credentialId: string | null;
  /** Absent on a dry run. */
  secret?: ResolvedSecret;
};

export type CredentialUnavailableReason =
  /** Nothing connected for this provider at all. */
  | "not_connected"
  /** Connected, but no connected kind runs on this executor. */
  | "unsupported_here"
  /** Connected and runnable, but the member kept it out of shared workspaces. */
  | "not_allowed_in_shared_workspaces";

export type CredentialUnavailable = {
  ok: false;
  provider: ProviderId;
  reason: CredentialUnavailableReason;
  /** Everything the member has connected for this provider, whether or not
   *  it runs here — so the UI can say "connected for chat rooms only"
   *  instead of "not set up". */
  connectedKinds: CredentialKind[];
};

export type ResolveResult = ResolvedCredentialRecord | CredentialUnavailable;

type Loaded = {
  credentialId: string | null;
  source: CredentialSource;
  /** Whether the member allows this credential inside a shared workspace. */
  allowInSharedWorkspaces: boolean;
  read: () => Promise<ResolvedSecret | null>;
};

/* -------------------------------------------------------------------------
 * Loaders: one per credential kind. A new provider adds one of these and an
 * entry in the registry — nothing else.
 * ---------------------------------------------------------------------- */

async function loadCodexAuthCache(input: ResolveInput): Promise<Loaded | null> {
  const hosted = await resolveHostedCodexSubscription({
    userId: input.userId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  });
  if (!hosted?.credential.encryptedMaterial) return null;
  const material = hosted.credential.encryptedMaterial;
  return {
    credentialId: hosted.credential.id,
    source: hosted.source === "WORKSPACE" ? "shared" : "personal",
    allowInSharedWorkspaces:
      hosted.credential.allowInSharedWorkspaces !== false,
    read: async () => {
      const decrypted = await decryptHostedMaterial(material);
      return decrypted.authCacheJson
        ? { kind: "codex_auth_cache", authCacheJson: decrypted.authCacheJson }
        : null;
    },
  };
}

type CredentialRow = typeof schema.providerCredentials.$inferSelect;

async function findRow(
  scopeType: "USER" | "WORKSPACE" | "WORKSPACE",
  scopeId: string,
  vendor: string,
  credentialType: "API_KEY" | "OAUTH_TOKEN",
): Promise<CredentialRow | null> {
  const [row] = await getDatabase()
    .select()
    .from(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.scopeType, scopeType),
        eq(schema.providerCredentials.scopeId, scopeId),
        eq(schema.providerCredentials.provider, vendor as never),
        eq(schema.providerCredentials.credentialType, credentialType),
        eq(schema.providerCredentials.isConnected, true),
        eq(schema.providerCredentials.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Personal row wins; a shared one needs both its sharing flag and real
 *  membership. Mirrors `resolvePersonalOrSharedCredential`. */
async function findPersonalOrShared(
  input: ResolveInput,
  vendor: string,
  credentialType: "API_KEY" | "OAUTH_TOKEN",
  accept: (row: CredentialRow) => boolean = () => true,
): Promise<{ row: CredentialRow; source: CredentialSource } | null> {
  const personal = await findRow("USER", input.userId, vendor, credentialType);
  if (personal && accept(personal)) {
    return { row: personal, source: "personal" };
  }
  if (!input.workspaceId) return null;
  const shared = await findRow(
    "WORKSPACE",
    input.workspaceId,
    vendor,
    credentialType,
  );
  if (
    shared &&
    accept(shared) &&
    (await belongsToSharedScope(input.userId, input.workspaceId))
  ) {
    return { row: shared, source: "shared" };
  }
  return null;
}

function loadedFromRow(
  found: { row: CredentialRow; source: CredentialSource },
  read: (row: CredentialRow) => Promise<ResolvedSecret | null>,
): Loaded {
  return {
    credentialId: found.row.id,
    source: found.source,
    // NOT NULL default true in the schema; `!== false` keeps a row read
    // through a partial projection from reading as "denied".
    allowInSharedWorkspaces: found.row.allowInSharedWorkspaces !== false,
    read: () => read(found.row),
  };
}

async function loadClaudeSetupToken(
  input: ResolveInput,
): Promise<Loaded | null> {
  // Both sign-ins store a setup-token, so either provenance is valid; only
  // a key-shaped row would be the retired kind.
  const found = await findPersonalOrShared(
    input,
    "anthropic",
    "OAUTH_TOKEN",
    (row) =>
      row.connectedVia !== "api_key" && Boolean(row.encryptedAccessToken),
  );
  if (!found) return null;
  return loadedFromRow(found, async (row) => {
    const token = await decryptCredential(row.encryptedAccessToken);
    return token ? { kind: "claude_setup_token", token } : null;
  });
}

async function loadCursorTokens(input: ResolveInput): Promise<Loaded | null> {
  const found = await findPersonalOrShared(
    input,
    "cursor",
    "OAUTH_TOKEN",
    (row) => Boolean(row.encryptedAccessToken && row.encryptedRefreshToken),
  );
  if (!found) return null;
  return loadedFromRow(found, async (row) => {
    const [accessToken, refreshToken] = await Promise.all([
      decryptCredential(row.encryptedAccessToken),
      decryptCredential(row.encryptedRefreshToken),
    ]);
    return accessToken && refreshToken
      ? { kind: "cursor_tokens", accessToken, refreshToken }
      : null;
  });
}

async function loadApiKey(input: ResolveInput): Promise<Loaded | null> {
  const found = await findPersonalOrShared(
    input,
    providerVendor(input.provider),
    "API_KEY",
    (row) => Boolean(row.encryptedApiKey),
  );
  if (!found) return null;
  return loadedFromRow(found, async (row) => {
    const apiKey = await decryptCredential(row.encryptedApiKey);
    return apiKey ? { kind: "api_key", apiKey } : null;
  });
}

const CREDENTIAL_CONTEXT = {
  application: "codev",
  purpose: "provider-credential",
};

async function decryptCredential(encrypted: string | null) {
  if (!encrypted) return null;
  try {
    return await decryptSecret(encrypted, CREDENTIAL_CONTEXT);
  } catch {
    // Rows written before the KMS migration bound an encryption context.
    try {
      return await decryptSecret(encrypted);
    } catch {
      return null;
    }
  }
}

const LOADERS: Record<
  CredentialKind,
  (input: ResolveInput) => Promise<Loaded | null>
> = {
  codex_auth_cache: loadCodexAuthCache,
  claude_setup_token: loadClaudeSetupToken,
  cursor_tokens: loadCursorTokens,
  api_key: loadApiKey,
};

/* ---------------------------------------------------------------------- */

/** Every kind this member has connected for a provider, ignoring where it
 *  can run — the input to an honest "connected, but not here" message. The
 *  list comes from the registry so it cannot fall out of step with it. */
async function connectedKinds(input: ResolveInput): Promise<CredentialKind[]> {
  const found = await Promise.all(
    providerDefinition(input.provider).kinds.map(async (entry) =>
      (await LOADERS[entry.kind](input)) ? entry.kind : null,
    ),
  );
  return found.filter((kind): kind is CredentialKind => kind !== null);
}

/**
 * Resolve the credential a turn should run on, or say precisely why it
 * cannot. Never throws for an absent credential: an executor turns the
 * reason into its own message.
 */
export async function resolveCredential(
  input: ResolveInput,
): Promise<ResolveResult> {
  const runnable = runnableKinds(input.provider, input.surface);
  let blockedBySharing = false;

  for (const entry of runnable) {
    const loaded = await LOADERS[entry.kind](input);
    if (!loaded) continue;
    // The member's own credential funds the turn, so they decide whether it
    // may be spent inside a workspace other people can see.
    if (input.surface !== "rooms" && !loaded.allowInSharedWorkspaces) {
      blockedBySharing = true;
      continue;
    }
    if (input.dryRun) {
      return {
        ok: true,
        provider: input.provider,
        kind: entry.kind,
        source: loaded.source,
        credentialId: loaded.credentialId,
      };
    }
    const secret = await loaded.read();
    if (!secret) continue;
    return {
      ok: true,
      provider: input.provider,
      kind: entry.kind,
      source: loaded.source,
      credentialId: loaded.credentialId,
      secret,
    };
  }

  const connected = await connectedKinds(input);
  return {
    ok: false,
    provider: input.provider,
    reason: blockedBySharing
      ? "not_allowed_in_shared_workspaces"
      : connected.length > 0
        ? "unsupported_here"
        : "not_connected",
    connectedKinds: connected,
  };
}

/** `resolveCredential` for a turn that is about to run: the secret, or a
 *  thrown error carrying the member-facing reason. */
export async function requireCredential(
  input: Omit<ResolveInput, "dryRun">,
): Promise<ResolvedCredentialRecord & { secret: ResolvedSecret }> {
  const result = await resolveCredential(input);
  if (!result.ok) throw new CredentialUnavailableError(result);
  if (!result.secret) {
    throw new CredentialUnavailableError({
      ok: false,
      provider: input.provider,
      reason: "not_connected",
      connectedKinds: [],
    });
  }
  return result as ResolvedCredentialRecord & { secret: ResolvedSecret };
}

export class CredentialUnavailableError extends Error {
  readonly status = 409;
  readonly code = "provider_connection_required";
  readonly reason: CredentialUnavailableReason;
  readonly provider: ProviderId;
  readonly connectedKinds: CredentialKind[];

  constructor(unavailable: CredentialUnavailable) {
    super(describeUnavailable(unavailable));
    this.name = "CredentialUnavailableError";
    this.reason = unavailable.reason;
    this.provider = unavailable.provider;
    this.connectedKinds = unavailable.connectedKinds;
  }
}

const PROVIDER_LABEL: Record<ProviderId, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
};

export function describeUnavailable(
  unavailable: CredentialUnavailable,
): string {
  const label = PROVIDER_LABEL[unavailable.provider];
  switch (unavailable.reason) {
    case "not_connected":
      return `Connect ${label} in Settings to run it here.`;
    case "unsupported_here":
      // Naming this case matters: the member *has* connected the agent and
      // would read "not set up" as a bug.
      return `Your ${label} connection cannot run here yet. Connect a login this surface supports in Settings.`;
    case "not_allowed_in_shared_workspaces":
      return `${label} is set to stay out of shared workspaces. Allow it in Settings to run it here.`;
  }
}

/* ---------------------------------------------------------------------- */

export type ProviderReadiness = {
  ready: boolean;
  kind: CredentialKind | null;
  source: CredentialSource | null;
  reason: CredentialUnavailableReason | null;
  connectedKinds: CredentialKind[];
};

export type ReadinessReport = Record<
  ProviderId,
  Record<ExecutorSurface, ProviderReadiness>
>;

function toReadiness(result: ResolveResult): ProviderReadiness {
  return result.ok
    ? {
        ready: true,
        kind: result.kind,
        source: result.source,
        reason: null,
        connectedKinds: [result.kind],
      }
    : {
        ready: false,
        kind: null,
        source: null,
        reason: result.reason,
        connectedKinds: result.connectedKinds,
      };
}

/**
 * What every readiness surface renders from: the same walk a turn performs,
 * without decrypting anything. There is no second table to keep in step.
 */
export async function providerReadiness(
  userId: string,
  workspaceId?: string,
): Promise<ReadinessReport> {
  const entries = await Promise.all(
    PROVIDER_IDS.map(async (provider) => {
      const surfaces = await Promise.all(
        EXECUTOR_SURFACES.map(async (surface) => {
          const result = await resolveCredential({
            userId,
            provider,
            surface,
            ...(workspaceId ? { workspaceId } : {}),
            dryRun: true,
          });
          return [surface, toReadiness(result)] as const;
        }),
      );
      return [
        provider,
        Object.fromEntries(surfaces) as Record<
          ExecutorSurface,
          ProviderReadiness
        >,
      ] as const;
    }),
  );
  return Object.fromEntries(entries) as ReadinessReport;
}

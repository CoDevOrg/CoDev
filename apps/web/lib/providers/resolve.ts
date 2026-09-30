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
  providerDefinition,
  providerVendor,
  runnableKinds,
  type CredentialKind,
  type ExecutorSurface,
  type ProviderId,
  type ResolvedSecret,
} from "./registry";

/**
 * The one credential resolver.
 *
 * It resolves personal credentials for Rooms and Gen 2 from the same
 * capability table the settings page uses.
 *
 * Resolution order is the provider's own kind order from the registry,
 * filtered to the kinds the target executor can run.
 */

export type ResolveInput = {
  userId: string;
  provider: ProviderId;
  surface: ExecutorSurface;
  /** Skip decryption — for readiness, which needs only "would this work". */
  dryRun?: boolean | undefined;
};

export type CredentialSource = "personal";

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
  const hosted = await resolveHostedCodexSubscription({ userId: input.userId });
  if (!hosted?.credential.encryptedMaterial) return null;
  const material = hosted.credential.encryptedMaterial;
  return {
    credentialId: hosted.credential.id,
    source: "personal",
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
  userId: string,
  vendor: string,
  credentialType: "API_KEY" | "OAUTH_TOKEN",
): Promise<CredentialRow | null> {
  const [row] = await getDatabase()
    .select()
    .from(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.scopeType, "USER"),
        eq(schema.providerCredentials.scopeId, userId),
        eq(schema.providerCredentials.provider, vendor as never),
        eq(schema.providerCredentials.credentialType, credentialType),
        eq(schema.providerCredentials.isConnected, true),
        eq(schema.providerCredentials.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

function loadedFromRow(
  row: CredentialRow,
  read: (row: CredentialRow) => Promise<ResolvedSecret | null>,
): Loaded {
  return {
    credentialId: row.id,
    source: "personal",
    // NOT NULL default true in the schema; `!== false` keeps a row read
    // through a partial projection from reading as "denied".
    allowInSharedWorkspaces: row.allowInSharedWorkspaces !== false,
    read: () => read(row),
  };
}

async function loadClaudeSetupToken(
  input: ResolveInput,
): Promise<Loaded | null> {
  const row = await findRow(input.userId, "anthropic", "OAUTH_TOKEN");
  if (
    !row ||
    row.connectedVia === "api_key" ||
    !row.encryptedAccessToken
  ) {
    return null;
  }
  return loadedFromRow(row, async (row) => {
    const token = await decryptCredential(row.encryptedAccessToken);
    return token ? { kind: "claude_setup_token", token } : null;
  });
}

async function loadApiKey(input: ResolveInput): Promise<Loaded | null> {
  const row = await findRow(
    input.userId,
    providerVendor(input.provider),
    "API_KEY",
  );
  if (!row?.encryptedApiKey) return null;
  return loadedFromRow(row, async (row) => {
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

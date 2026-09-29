import "server-only";

import {
  CredentialUnavailableError,
  requireCredential,
  resolveCredential,
} from "../providers/resolve";
import { codexApiKeyAuthCache, launchProfileFor } from "../providers/registry";
import type { ProviderId } from "../providers/registry";
import { Gen2LifecycleError } from "./errors";

/**
 * Which credential a Gen 2 turn should run on.
 *
 * Gen 2 resolves the *initiating member's own* credential and never a
 * workspace-shared one. That is the point of a shared machine: the work lands
 * in a place everyone can see, but it is billed to, and authorised by, the
 * person who asked for it. Passing no workspace id is what enforces it —
 * `resolveCredential` only reaches a shared row when given one.
 *
 * The lookup itself is no longer written here. It used to be: a bespoke
 * subscription-then-API-key walk that consulted none of the flags the
 * settings page rendered, so a credential the member had disabled still ran.
 * It now asks the one resolver, on the `gen2` executor, and the registry
 * decides what that executor can run.
 */
export type Gen2Credential = {
  /** Set only for a subscription, which holds a one-turn-at-a-time lease. */
  credentialId: string | null;
  authCacheJson: string;
  via: "subscription" | "api-key";
};

export const GEN2_CONNECT_MESSAGE =
  "Connect ChatGPT or add an OpenAI API key to run Codex here.";

/** The `auth.json` shape the Codex CLI uses for plain API-key auth. */
export const buildApiKeyAuthCache = codexApiKeyAuthCache;

/** Gen 2 runs Codex today. The guest exec route carries a Codex auth cache by
 *  name and has no channel for an environment variable, so Claude's
 *  setup-token cannot reach it yet — see `LaunchProfile` in the registry. */
const GEN2_PROVIDER: ProviderId = "codex";

/**
 * The guest still takes `codexAuthCacheJson` as a named field, so the neutral
 * launch profile is unwrapped back into it here. When the guest accepts a
 * profile (files + env) this shim is what goes away, not the resolver.
 */
function authCacheFromProfile(
  provider: ProviderId,
  secret: Parameters<typeof launchProfileFor>[1],
): string | null {
  const profile = launchProfileFor(provider, secret);
  return (
    profile.files?.find((file) => file.path === ".codex/auth.json")?.contents ??
    null
  );
}

export async function resolveGen2Codex(
  userId: string,
): Promise<Gen2Credential> {
  let resolved;
  try {
    resolved = await requireCredential({
      userId,
      provider: GEN2_PROVIDER,
      surface: "gen2",
    });
  } catch (error) {
    if (error instanceof CredentialUnavailableError) {
      throw new Gen2LifecycleError(
        error.reason === "not_connected" ? GEN2_CONNECT_MESSAGE : error.message,
        409,
      );
    }
    throw error;
  }

  const authCacheJson = authCacheFromProfile(GEN2_PROVIDER, resolved.secret);
  if (!authCacheJson) {
    throw new Gen2LifecycleError(
      "Reconnect Codex; the stored connection uses an obsolete format.",
      409,
    );
  }
  return {
    // Only a subscription holds a seat; an API key has no one-turn-at-a-time
    // limit, so it carries no lease for the caller to claim.
    credentialId:
      resolved.kind === "codex_auth_cache" ? resolved.credentialId : null,
    authCacheJson,
    via: resolved.kind === "codex_auth_cache" ? "subscription" : "api-key",
  };
}

export type Gen2ProviderStatus = {
  connected: boolean;
  via: "subscription" | "api-key" | null;
};

/** Drives the connect prompt in the workspace; never returns a secret. */
export async function getGen2ProviderStatus(
  userId: string,
): Promise<Gen2ProviderStatus> {
  const result = await resolveCredential({
    userId,
    provider: GEN2_PROVIDER,
    surface: "gen2",
    dryRun: true,
  });
  if (!result.ok) return { connected: false, via: null };
  return {
    connected: true,
    via: result.kind === "codex_auth_cache" ? "subscription" : "api-key",
  };
}

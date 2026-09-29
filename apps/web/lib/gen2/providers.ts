import "server-only";

import {
  CredentialUnavailableError,
  requireCredential,
  resolveCredential,
} from "../providers/resolve";
import { codexApiKeyAuthCache, launchProfileFor } from "../providers/registry";
import type { LaunchProfile, ProviderId } from "../providers/registry";
import { listDecryptedUserEnvironmentVariables } from "../providers/user-environment";
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
  /** The same credential in the provider-neutral shape, plus the member's
   *  own environment variables. Sent alongside `authCacheJson` so the turn
   *  runs whichever guest image the host happens to have. */
  launchProfile: LaunchProfile;
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
 * The Codex auth cache inside a launch profile.
 *
 * Both are sent: a guest that understands `launchProfile` uses it, and one
 * that has not been redeployed yet falls back to the named field it has
 * always taken. That is what makes turning the profile on safe without first
 * proving which image every host is running. The legacy field goes once the
 * new guest is everywhere.
 */
function authCacheFromProfile(profile: LaunchProfile): string | null {
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

  const credentialProfile = launchProfileFor(GEN2_PROVIDER, resolved.secret);
  const authCacheJson = authCacheFromProfile(credentialProfile);
  if (!authCacheJson) {
    throw new Gen2LifecycleError(
      "Reconnect Codex; the stored connection uses an obsolete format.",
      409,
    );
  }

  // The member's own environment variables ride the same channel. They are
  // listed first so a variable named after one the credential needs — say
  // CODEX_HOME — cannot displace it and point the CLI somewhere else.
  const memberEnvironment = await listDecryptedUserEnvironmentVariables(userId);
  const launchProfile: LaunchProfile = {
    ...credentialProfile,
    env: { ...memberEnvironment, ...credentialProfile.env },
  };

  return {
    // Only a subscription holds a seat; an API key has no one-turn-at-a-time
    // limit, so it carries no lease for the caller to claim.
    credentialId:
      resolved.kind === "codex_auth_cache" ? resolved.credentialId : null,
    authCacheJson,
    launchProfile,
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

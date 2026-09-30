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
  /** Set only for a Codex subscription, which holds a one-turn-at-a-time
   *  lease. */
  credentialId: string | null;
  /** The Codex `auth.json`, for guest images that predate `launchProfile`.
   *  Null for Claude, whose credential is an environment variable that a
   *  guest without profile support has no field to receive. */
  authCacheJson: string | null;
  /** The same credential in the provider-neutral shape, plus the member's
   *  own environment variables. Sent alongside `authCacheJson` so a Codex
   *  turn runs whichever guest image the host happens to have. */
  launchProfile: LaunchProfile;
  via: "subscription" | "api-key";
};

/** The providers a Gen 2 turn can be asked to run. Which of them a credential
 *  can actually serve is the registry's `gen2` flag, not this list. */
export type Gen2AgentProvider = Extract<ProviderId, "codex" | "claude">;

export const GEN2_DEFAULT_PROVIDER: Gen2AgentProvider = "codex";

export const GEN2_CONNECT_MESSAGES: Record<Gen2AgentProvider, string> = {
  codex: "Connect ChatGPT or add an OpenAI API key to run Codex here.",
  claude: "Connect your Claude subscription to run Claude here.",
};
export const GEN2_CONNECT_MESSAGE = GEN2_CONNECT_MESSAGES.codex;

/** The `auth.json` shape the Codex CLI uses for plain API-key auth. */
export const buildApiKeyAuthCache = codexApiKeyAuthCache;

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

export async function resolveGen2Credential(
  userId: string,
  provider: Gen2AgentProvider = GEN2_DEFAULT_PROVIDER,
): Promise<Gen2Credential> {
  let resolved;
  try {
    resolved = await requireCredential({
      userId,
      provider,
      surface: "gen2",
    });
  } catch (error) {
    if (error instanceof CredentialUnavailableError) {
      throw new Gen2LifecycleError(
        error.reason === "not_connected"
          ? GEN2_CONNECT_MESSAGES[provider]
          : error.message,
        409,
      );
    }
    throw error;
  }

  const credentialProfile = launchProfileFor(provider, resolved.secret);
  const authCacheJson =
    provider === "codex" ? authCacheFromProfile(credentialProfile) : null;
  if (provider === "codex" && !authCacheJson) {
    throw new Gen2LifecycleError(
      "Reconnect Codex; the stored connection uses an obsolete format.",
      409,
    );
  }

  // The member's own environment variables ride the same channel. They are
  // listed first so a variable named after one the credential needs — say
  // CODEX_HOME or CLAUDE_CODE_OAUTH_TOKEN — cannot displace it and point the
  // CLI somewhere else.
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
    via: resolved.kind === "api_key" ? "api-key" : "subscription",
  };
}

export type Gen2ProviderStatus = {
  connected: boolean;
  via: "subscription" | "api-key" | null;
};

/** Drives the connect prompt in the workspace; never returns a secret. */
export async function getGen2ProviderStatus(
  userId: string,
  provider: Gen2AgentProvider = GEN2_DEFAULT_PROVIDER,
): Promise<Gen2ProviderStatus> {
  const result = await resolveCredential({
    userId,
    provider,
    surface: "gen2",
    dryRun: true,
  });
  if (!result.ok) return { connected: false, via: null };
  return {
    connected: true,
    via: result.kind === "api_key" ? "api-key" : "subscription",
  };
}

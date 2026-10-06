import "server-only";

import {
  CredentialUnavailableError,
  requireCredential,
  resolveCredential,
} from "../providers/resolve";
import {
  codexApiKeyAuthCache,
  launchProfileFor,
  providerDefinition,
} from "../providers/registry";
import type { Gen2AgentProviderName } from "@codev/contracts";
import type { LaunchProfile } from "../providers/registry";
import { getDynamicModelsForProvider } from "../providers/dynamic-models";
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
  /** Set only for a credential that holds a one-turn-at-a-time seat (a Codex
   *  subscription); Claude and API keys carry none. */
  credentialId: string | null;
  /** The same credential in the provider-neutral shape, plus the member's
   *  own environment variables. The guest materialises it and knows nothing
   *  about which provider it belongs to. */
  launchProfile: LaunchProfile;
  via: "subscription" | "api-key";
};

/** The providers a Gen 2 turn can be asked to run. Which of them a credential
 *  can actually serve is the registry's `gen2` flag, not this list. */
export type Gen2AgentProvider = Gen2AgentProviderName;

/** The `auth.json` shape the Codex CLI uses for plain API-key auth. */
export const buildApiKeyAuthCache = codexApiKeyAuthCache;

export async function resolveGen2Credential(
  userId: string,
  provider: Gen2AgentProvider,
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
          ? `Connect ${providerDefinition(provider).label} to run it here.`
          : error.message,
        409,
      );
    }
    throw error;
  }

  const credentialProfile = launchProfileFor(provider, resolved.secret);
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
    launchProfile,
    via: resolved.kind === "api_key" ? "api-key" : "subscription",
  };
}

export type { Gen2ProviderStatus } from "@codev/contracts";
import type { Gen2ProviderStatus } from "@codev/contracts";

/** Drives the connect prompt in the workspace; never returns a secret. */
export async function getGen2ProviderStatus(
  userId: string,
  provider: Gen2AgentProvider,
): Promise<Gen2ProviderStatus> {
  const result = await resolveCredential({
    userId,
    provider,
    surface: "gen2",
    dryRun: true,
  });
  if (!result.ok) return { connected: false, via: null, models: [] };
  const via = result.kind === "api_key" ? "api-key" : "subscription";
  try {
    return {
      connected: true,
      via,
      models: await getDynamicModelsForProvider(provider, userId),
    };
  } catch {
    return {
      connected: true,
      via,
      models: [],
      modelsError:
        "Couldn't load your account's models. Please refresh and try again.",
    };
  }
}

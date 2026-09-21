import "server-only";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { decryptSecret } from "../platform/kms";
import {
  decryptHostedMaterial,
  resolveHostedCodexSubscription,
} from "../providers/hosted-codex-subscription-credentials";
import { Gen2LifecycleError } from "./errors";

/**
 * Which credential a Gen 2 turn should run on.
 *
 * Gen 2 resolves the *initiating member's own* credential and never a
 * workspace-shared one. That is the point of a shared machine: the work lands
 * in a place everyone can see, but it is billed to, and authorised by, the
 * person who asked for it.
 *
 * Both shapes end up as a Codex `auth.json`, so the transport to the guest is
 * identical -- encrypted in flight, written to a private 0700 directory, never
 * passed on the command line where another member's shell could read it out of
 * `ps`.
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
export function buildApiKeyAuthCache(apiKey: string) {
  return JSON.stringify({
    auth_mode: "apikey",
    OPENAI_API_KEY: apiKey,
    tokens: null,
    last_refresh: new Date().toISOString(),
  });
}

async function findPersonalOpenAiApiKey(userId: string) {
  const [row] = await getDatabase()
    .select({
      encryptedApiKey: schema.providerCredentials.encryptedApiKey,
    })
    .from(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.scopeType, "USER"),
        eq(schema.providerCredentials.scopeId, userId),
        eq(schema.providerCredentials.provider, "openai"),
        eq(schema.providerCredentials.credentialType, "API_KEY"),
        eq(schema.providerCredentials.isConnected, true),
      ),
    )
    .limit(1);
  if (!row?.encryptedApiKey) return null;
  try {
    return await decryptSecret(row.encryptedApiKey);
  } catch {
    return null;
  }
}

/**
 * Subscription first, then a personal API key.
 *
 * `includeBusy` is deliberate: a subscription that is mid-turn should report
 * "already running a turn" from the lease, not silently fall through to a
 * different credential and bill the member twice over.
 */
export async function resolveGen2Codex(
  userId: string,
): Promise<Gen2Credential> {
  const hosted = await resolveHostedCodexSubscription({
    userId,
    includeBusy: true,
  });
  if (hosted?.credential.encryptedMaterial) {
    const material = await decryptHostedMaterial(
      hosted.credential.encryptedMaterial,
    );
    if (material.authCacheJson) {
      return {
        credentialId: hosted.credential.id,
        authCacheJson: material.authCacheJson,
        via: "subscription",
      };
    }
  }

  const apiKey = await findPersonalOpenAiApiKey(userId);
  if (apiKey) {
    return {
      credentialId: null,
      authCacheJson: buildApiKeyAuthCache(apiKey),
      via: "api-key",
    };
  }

  throw new Gen2LifecycleError(GEN2_CONNECT_MESSAGE, 409);
}

export type Gen2ProviderStatus = {
  connected: boolean;
  via: "subscription" | "api-key" | null;
};

/** Drives the connect prompt in the workspace; never returns a secret. */
export async function getGen2ProviderStatus(
  userId: string,
): Promise<Gen2ProviderStatus> {
  const hosted = await resolveHostedCodexSubscription({
    userId,
    includeBusy: true,
  });
  if (hosted?.credential.encryptedMaterial) {
    return { connected: true, via: "subscription" };
  }
  if (await findPersonalOpenAiApiKey(userId)) {
    return { connected: true, via: "api-key" };
  }
  return { connected: false, via: null };
}

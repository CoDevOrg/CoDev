import "server-only";

import {
  destroyHostedCodexRuntimeGrants,
  markHostedCodexGrantDelivered,
  mintHostedCodexRuntimeGrant,
  resolveHostedCodexSubscription,
} from "./hosted-codex-subscription-credentials";
import { isHostedCodexSubscriptionEnabled } from "./hosted-codex-subscription-flag";
import { consumeRateLimit } from "./rate-limit";

export type HostedCodexRuntimeDelivery = {
  grantId: string;
  audience: string;
  expiresAt: string;
};

/**
 * Mint and inject a short-lived runtime grant after the sandbox exists.
 * Provision requests must not include provider credential material.
 */
export async function deliverHostedCodexRuntimeGrant(input: {
  userId: string;
  workspaceId: string;
  inject: (grant: {
    token: string;
    audience: string;
    expiresAt: Date;
  }) => Promise<void>;
}): Promise<HostedCodexRuntimeDelivery | null> {
  if (!isHostedCodexSubscriptionEnabled()) return null;
  const resolved = await resolveHostedCodexSubscription(input);
  if (!resolved) return null;
  const limit = await consumeRateLimit(
    input.workspaceId,
    "hosted-codex-runtime-grant",
    60,
    3600,
  );
  if (!limit.allowed) {
    throw new Error(
      "Runtime grant issuance is rate limited for this workspace.",
    );
  }
  const grant = await mintHostedCodexRuntimeGrant({
    userId: input.userId,
    workspaceId: input.workspaceId,
    audience: `sandbox:${input.workspaceId}`,
  });
  await input.inject({
    token: grant.token,
    audience: grant.audience,
    expiresAt: grant.expiresAt,
  });
  await markHostedCodexGrantDelivered(grant.id);
  return {
    grantId: grant.id,
    audience: grant.audience,
    expiresAt: grant.expiresAt.toISOString(),
  };
}

export async function destroyHostedCodexRuntimeAuth(workspaceId: string) {
  await destroyHostedCodexRuntimeGrants(workspaceId);
}

export function provisionPayloadContainsProviderCredential(
  payload: Record<string, unknown>,
) {
  const serialized = JSON.stringify(payload).toLowerCase();
  return [
    "accesstoken",
    "refresh_token",
    "encrypted_material",
    "authorization",
    "api_key",
    "openai_api_key",
  ].some((needle) => serialized.includes(needle));
}

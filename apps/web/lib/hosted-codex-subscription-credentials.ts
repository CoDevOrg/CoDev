import "server-only";

import { and, eq, isNull, lt, or } from "drizzle-orm";

import { schema } from "@codev/db";
import type { HostedCodexScopeType } from "@codev/shared-types";

import { getDatabase } from "./database";
import { recordHostedCodexAuditEvent } from "./hosted-codex-subscription-audit";
import { isHostedCodexSubscriptionEnabled } from "./hosted-codex-subscription-flag";
import {
  HOSTED_CODEX_KIND,
  type HostedCodexPublicStatus,
} from "./hosted-codex-subscription-view";
import { decryptSecret, encryptSecret } from "./kms";

const HOSTED_CODEX_CONTEXT = {
  application: "codev",
  purpose: "hosted-codex-subscription",
};

export class HostedCodexSubscriptionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "hosted_codex_error",
  ) {
    super(message);
    this.name = "HostedCodexSubscriptionError";
  }
}

export type HostedCodexMaterial = { authCacheJson: string };

async function encryptHostedMaterial(material: HostedCodexMaterial) {
  return encryptSecret(JSON.stringify(material), HOSTED_CODEX_CONTEXT);
}

export async function decryptHostedMaterial(encrypted: string) {
  return JSON.parse(
    await decryptSecret(encrypted, HOSTED_CODEX_CONTEXT),
  ) as HostedCodexMaterial;
}

function validateAuthCache(authCacheJson: string) {
  if (Buffer.byteLength(authCacheJson, "utf8") > 128 * 1024) {
    throw new HostedCodexSubscriptionError(
      "The Codex auth cache is too large.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(authCacheJson);
  } catch {
    throw new HostedCodexSubscriptionError("The Codex auth cache is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HostedCodexSubscriptionError("The Codex auth cache is invalid.");
  }
}

export async function updateHostedCodexAuthCache(
  credentialId: string,
  authCacheJson: string,
) {
  validateAuthCache(authCacheJson);
  await getDatabase()
    .update(schema.providerCredentials)
    .set({
      encryptedMaterial: await encryptHostedMaterial({ authCacheJson }),
      lastRefreshedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.providerCredentials.id, credentialId));
}

export async function claimHostedCodexExecution(credentialId: string) {
  const [claimed] = await getDatabase()
    .update(schema.providerCredentials)
    .set({
      unavailableUntil: new Date(Date.now() + 16 * 60 * 1_000),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.providerCredentials.id, credentialId),
        eq(schema.providerCredentials.status, "active"),
        eq(schema.providerCredentials.isConnected, true),
        or(
          isNull(schema.providerCredentials.unavailableUntil),
          lt(schema.providerCredentials.unavailableUntil, new Date()),
        ),
      ),
    )
    .returning({ id: schema.providerCredentials.id });
  if (!claimed) {
    throw new HostedCodexSubscriptionError(
      "This Codex connection is already running another cloud turn. Try again shortly.",
      409,
      "hosted_codex_busy",
    );
  }
}

export async function releaseHostedCodexExecution(credentialId: string) {
  await getDatabase()
    .update(schema.providerCredentials)
    .set({ unavailableUntil: null, updatedAt: new Date() })
    .where(eq(schema.providerCredentials.id, credentialId));
}

export async function persistHostedCodexConnection(input: {
  userId: string;
  scopeType: HostedCodexScopeType;
  scopeId: string;
  sharingEnabled: boolean;
  material: HostedCodexMaterial;
  accountLabel?: string;
}) {
  validateAuthCache(input.material.authCacheJson);
  const encryptedMaterial = await encryptHostedMaterial(input.material);
  const [credential] = await getDatabase()
    .insert(schema.providerCredentials)
    .values({
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      provider: "openai",
      credentialType: "HOSTED_CODEX_SUBSCRIPTION",
      encryptedMaterial,
      isConnected: true,
      keyVersion: 2,
      lastFour: input.accountLabel ?? "Codex CLI",
      status: "active",
      lastRefreshedAt: new Date(),
      createdBy: input.userId,
      sharingEnabled: input.sharingEnabled,
      unavailableUntil: null,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: [
        schema.providerCredentials.scopeType,
        schema.providerCredentials.scopeId,
        schema.providerCredentials.provider,
        schema.providerCredentials.credentialType,
      ],
      set: {
        encryptedMaterial,
        isConnected: true,
        keyVersion: 2,
        lastFour: input.accountLabel ?? "Codex CLI",
        status: "active",
        lastRefreshedAt: new Date(),
        createdBy: input.userId,
        sharingEnabled: input.sharingEnabled,
        unavailableUntil: null,
        revokedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: schema.providerCredentials.id });
  await recordHostedCodexAuditEvent({
    credentialId: credential?.id ?? null,
    actorId: input.userId,
    type: "connection_created",
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    result: "success",
  });
}

async function findActiveHostedCredential(
  scopeType: HostedCodexScopeType,
  scopeId: string,
) {
  const [credential] = await getDatabase()
    .select()
    .from(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.scopeType, scopeType),
        eq(schema.providerCredentials.scopeId, scopeId),
        eq(schema.providerCredentials.provider, "openai"),
        eq(
          schema.providerCredentials.credentialType,
          "HOSTED_CODEX_SUBSCRIPTION",
        ),
        eq(schema.providerCredentials.status, "active"),
        eq(schema.providerCredentials.isConnected, true),
      ),
    )
    .limit(1);
  if (
    credential?.unavailableUntil &&
    credential.unavailableUntil.getTime() > Date.now()
  ) {
    return null;
  }
  return credential ?? null;
}

async function userBelongsToOrganization(
  userId: string,
  organizationId: string,
) {
  const [membership] = await getDatabase()
    .select({ userId: schema.workspaceMembers.userId })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, organizationId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(membership);
}

export async function resolveHostedCodexSubscription(input: {
  userId: string;
  workspaceId: string;
}) {
  if (!isHostedCodexSubscriptionEnabled()) return null;
  const personal = await findActiveHostedCredential("USER", input.userId);
  if (personal) return { credential: personal, source: "USER" as const };
  const organization = await findActiveHostedCredential(
    "ORGANIZATION",
    input.workspaceId,
  );
  if (
    organization?.sharingEnabled &&
    (await userBelongsToOrganization(input.userId, input.workspaceId))
  ) {
    return { credential: organization, source: "ORGANIZATION" as const };
  }
  return null;
}

export async function getHostedCodexPublicStatus(input: {
  scopeType: HostedCodexScopeType;
  scopeId: string;
  canManage: boolean;
}): Promise<HostedCodexPublicStatus> {
  const enabled = isHostedCodexSubscriptionEnabled();
  const [credential] = await getDatabase()
    .select()
    .from(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.scopeType, input.scopeType),
        eq(schema.providerCredentials.scopeId, input.scopeId),
        eq(schema.providerCredentials.provider, "openai"),
        eq(
          schema.providerCredentials.credentialType,
          "HOSTED_CODEX_SUBSCRIPTION",
        ),
      ),
    )
    .limit(1);
  const connected = Boolean(
    credential?.isConnected &&
    credential.status === "active" &&
    credential.encryptedMaterial,
  );
  return {
    kind: HOSTED_CODEX_KIND,
    scopeType: input.scopeType,
    status: connected ? "connected" : enabled ? "not_connected" : "unavailable",
    stateText: connected
      ? input.scopeType === "ORGANIZATION"
        ? "Connected for this organization"
        : "Connected · Codex CLI"
      : "Not connected",
    accountLabel: connected ? "Codex CLI" : null,
    sharingEnabled: Boolean(credential?.sharingEnabled),
    canManage: input.canManage,
    enabled,
    configured: enabled,
  };
}

export async function disconnectHostedCodexSubscription(input: {
  userId: string;
  scopeType: HostedCodexScopeType;
  scopeId: string;
}) {
  const [credential] = await getDatabase()
    .delete(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.scopeType, input.scopeType),
        eq(schema.providerCredentials.scopeId, input.scopeId),
        eq(schema.providerCredentials.provider, "openai"),
        eq(
          schema.providerCredentials.credentialType,
          "HOSTED_CODEX_SUBSCRIPTION",
        ),
      ),
    )
    .returning({ id: schema.providerCredentials.id });
  if (credential) {
    await recordHostedCodexAuditEvent({
      credentialId: credential.id,
      actorId: input.userId,
      type: "disconnect",
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      result: "success",
    });
  }
}

export type { HostedCodexPublicStatus } from "./hosted-codex-subscription-view";

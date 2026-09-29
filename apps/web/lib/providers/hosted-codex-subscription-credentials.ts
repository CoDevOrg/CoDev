import "server-only";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";
import type { HostedCodexScopeType } from "@codev/shared-types";

import { getDatabase } from "../platform/database";
import { recordHostedCodexAuditEvent } from "./hosted-codex-subscription-audit";
import { isHostedCodexSubscriptionEnabled } from "./hosted-codex-subscription-flag";
import {
  HOSTED_CODEX_KIND,
  type HostedCodexPublicStatus,
} from "./hosted-codex-subscription-view";
import { decryptSecret, encryptSecret } from "../platform/kms";
import { resolvePersonalOrSharedCredential } from "./scoped-credential-sharing";

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

export async function persistHostedCodexConnection(input: {
  userId: string;
  scopeType: HostedCodexScopeType;
  scopeId: string;
  material: HostedCodexMaterial;
  accountLabel?: string;
  /** Browser and CLI logins produce byte-identical auth caches, so the caller
   *  must say which it was: only a `cli` login may power a coding workspace. */
  connectedVia: "browser" | "cli";
  /** Whether this login may fund a turn in a shared workspace; the member's
   *  existing choice is kept on reconnect unless this is given. */
  allowInSharedWorkspaces?: boolean;
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
      revokedAt: null,
      connectedVia: input.connectedVia,
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
        encryptedMaterial,
        isConnected: true,
        keyVersion: 2,
        lastFour: input.accountLabel ?? "Codex CLI",
        status: "active",
        lastRefreshedAt: new Date(),
        createdBy: input.userId,
        revokedAt: null,
        connectedVia: input.connectedVia,
        ...(input.allowInSharedWorkspaces !== undefined
          ? { allowInSharedWorkspaces: input.allowInSharedWorkspaces }
          : {}),
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
  return credential ?? null;
}

/**
 * Whether the member has a Codex subscription connected — not whether it is
 * free. Busy is a seat question (`credential-seat.ts`) and is asked by the
 * caller that is about to run a turn; answering "not connected" for a login
 * that is merely mid-turn used to send members off to reconnect a perfectly
 * good credential.
 */
export async function resolveHostedCodexSubscription(input: {
  userId: string;
  workspaceId?: string;
}) {
  if (!isHostedCodexSubscriptionEnabled()) return null;
  return resolvePersonalOrSharedCredential(input, {
    findPersonal: (userId) => findActiveHostedCredential("USER", userId),
    findShared: (workspaceId) =>
      findActiveHostedCredential("WORKSPACE", workspaceId),
  });
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
      ? input.scopeType === "WORKSPACE"
        ? "Connected for this organization"
        : "Connected · Codex CLI"
      : "Not connected",
    accountLabel: connected ? "Codex CLI" : null,
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

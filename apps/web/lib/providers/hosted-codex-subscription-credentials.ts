import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { recordHostedCodexAuditEvent } from "./hosted-codex-subscription-audit";
import { isHostedCodexSubscriptionEnabled } from "./hosted-codex-subscription-flag";
import { decryptSecret, encryptSecret } from "../platform/kms";

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

/** An opaque, non-secret version of the encrypted credential at launch. */
export function hostedCodexCredentialRevision(encryptedMaterial: string) {
  return createHash("sha256").update(encryptedMaterial).digest("hex");
}

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

/**
 * A guest profile may only refresh the credential that launched it. Keeping
 * the creator check in this write-back path prevents a durable run mapping
 * from ever updating another member's encrypted connection.
 */
export async function updateHostedCodexAuthCacheForUser(input: {
  credentialId: string;
  userId: string;
  authCacheJson: string;
  /** Refuse a refresh from a profile launched with older credential material. */
  expectedRevision?: string | null;
}) {
  validateAuthCache(input.authCacheJson);
  const where = and(
    eq(schema.providerCredentials.id, input.credentialId),
    eq(schema.providerCredentials.scopeType, "USER"),
    eq(schema.providerCredentials.scopeId, input.userId),
    eq(schema.providerCredentials.provider, "openai"),
    eq(schema.providerCredentials.credentialType, "HOSTED_CODEX_SUBSCRIPTION"),
  );
  const [current] = await getDatabase()
    .select({ encryptedMaterial: schema.providerCredentials.encryptedMaterial })
    .from(schema.providerCredentials)
    .where(where)
    .limit(1);
  if (!current?.encryptedMaterial) return false;
  if (
    input.expectedRevision &&
    hostedCodexCredentialRevision(current.encryptedMaterial) !==
      input.expectedRevision
  ) {
    return false;
  }
  const updated = await getDatabase()
    .update(schema.providerCredentials)
    .set({
      encryptedMaterial: await encryptHostedMaterial({
        authCacheJson: input.authCacheJson,
      }),
      lastRefreshedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      input.expectedRevision
        ? and(
            where,
            eq(
              schema.providerCredentials.encryptedMaterial,
              current.encryptedMaterial,
            ),
          )
        : where,
    )
    .returning({ id: schema.providerCredentials.id });
  if (updated[0]) return true;
  if (input.expectedRevision) return false;
  throw new HostedCodexSubscriptionError(
    "The agent credential is no longer connected.",
    409,
  );
}

export async function persistHostedCodexConnection(input: {
  userId: string;
  material: HostedCodexMaterial;
  accountLabel?: string;
  /** Browser and CLI logins produce the same auth cache for the agent runtime. */
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
      scopeType: "USER",
      scopeId: input.userId,
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
    scopeType: "USER",
    scopeId: input.userId,
    result: "success",
  });
}

async function findActiveHostedCredential(userId: string) {
  const [credential] = await getDatabase()
    .select()
    .from(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.scopeType, "USER"),
        eq(schema.providerCredentials.scopeId, userId),
        eq(schema.providerCredentials.provider, "openai"),
        eq(
          schema.providerCredentials.credentialType,
          "HOSTED_CODEX_SUBSCRIPTION",
        ),
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
}) {
  if (!isHostedCodexSubscriptionEnabled()) return null;
  const credential = await findActiveHostedCredential(input.userId);
  return credential ? { credential, source: "USER" as const } : null;
}

export async function disconnectHostedCodexSubscription(input: {
  userId: string;
}) {
  const [credential] = await getDatabase()
    .delete(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.scopeType, "USER"),
        eq(schema.providerCredentials.scopeId, input.userId),
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
      scopeType: "USER",
      scopeId: input.userId,
      result: "success",
    });
  }
}

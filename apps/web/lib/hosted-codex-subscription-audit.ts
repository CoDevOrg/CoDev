import "server-only";

import { schema } from "@codev/db";
import type { HostedCodexScopeType } from "@codev/shared-types";

import { getDatabase } from "./database";
import { HOSTED_CODEX_KIND } from "./hosted-codex-subscription-view";

const SECRET_KEYS = [
  "access_token",
  "refresh_token",
  "id_token",
  "authorization",
  "code",
  "code_verifier",
  "encrypted_material",
  "encryptedGrant",
  "apiKeyOrToken",
];

export type HostedCodexAuditEventType =
  | "connection_created"
  | "connection_failed"
  | "scope_changed"
  | "runtime_grant_minted"
  | "runtime_grant_delivered"
  | "runtime_grant_destroyed"
  | "refresh"
  | "refresh_failed"
  | "fallback"
  | "disconnect"
  | "authorization_failed";

export function assertHostedCodexAuditPayloadIsRedacted(
  payload: Record<string, unknown>,
) {
  const serialized = JSON.stringify(payload).toLowerCase();
  for (const key of SECRET_KEYS) {
    if (key in payload || serialized.includes(key.replaceAll("_", ""))) {
      if (
        serialized.includes("access_token") ||
        serialized.includes("refresh_token") ||
        serialized.includes("code_verifier")
      ) {
        throw new Error("Hosted Codex audit events must not include secrets.");
      }
    }
  }
}

export async function recordHostedCodexAuditEvent(input: {
  credentialId?: string | null;
  actorId?: string | null;
  type: HostedCodexAuditEventType;
  scopeType?: HostedCodexScopeType;
  scopeId?: string;
  workspaceId?: string;
  result: "success" | "failure" | "blocked";
}) {
  const payload = {
    credentialId: input.credentialId ?? null,
    actorId: input.actorId ?? null,
    type: input.type,
    result: input.result,
  };
  assertHostedCodexAuditPayloadIsRedacted(payload);
  await getDatabase()
    .insert(schema.providerCredentialEvents)
    .values({
      credentialId: input.credentialId ?? null,
      actorId: input.actorId ?? null,
      provider: "openai",
      kind: HOSTED_CODEX_KIND,
      type: input.type,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      workspaceId: input.workspaceId,
      result: input.result,
    });
}

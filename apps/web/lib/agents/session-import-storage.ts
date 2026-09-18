import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  sessionCapsuleV0Schema,
  type SessionCapsuleV0,
} from "@codev/contracts";
import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { decryptSecret, encryptSecret } from "../platform/kms";
import { appendWorkspaceEvent } from "../workspaces/audit";

export const SESSION_CAPSULE_ARTIFACT_MEDIA_TYPE =
  "application/vnd.codev.session-capsule.v0";
export const MAX_STORED_SESSION_CAPSULE_BYTES = 32 * 1_024 * 1_024;

type Database = ReturnType<typeof getDatabase>;

export class SessionImportStorageError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "session_import_storage_error",
  ) {
    super(message);
    this.name = "SessionImportStorageError";
  }
}

export type SessionImportArtifactScope = {
  organizationId: string;
  workspaceId: string;
  importId: string;
  importedBy: string;
};

export type StoredSessionImportArtifact = {
  payload: Uint8Array;
  mediaType: string;
  sha256: string;
  bytes: number;
};

export interface SessionImportArtifactStore {
  put(input: {
    scope: SessionImportArtifactScope;
    payload: Uint8Array;
    mediaType: string;
    expectedSha256: string;
  }): Promise<{ created: boolean; sha256: string; bytes: number }>;
  get(
    scope: SessionImportArtifactScope,
  ): Promise<StoredSessionImportArtifact | null>;
  delete(scope: SessionImportArtifactScope): Promise<boolean>;
}

type AppendWorkspaceEvent = typeof appendWorkspaceEvent;

function sha256(payload: Uint8Array) {
  return createHash("sha256").update(payload).digest("hex");
}

function artifactEncryptionContext(scope: SessionImportArtifactScope) {
  return {
    application: "codev",
    purpose: "agent-session-import",
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    importId: scope.importId,
    importedBy: scope.importedBy,
  };
}

function artifactContextFingerprint(scope: SessionImportArtifactScope) {
  return sha256(
    new TextEncoder().encode(
      JSON.stringify(
        Object.entries(artifactEncryptionContext(scope)).sort(
          ([left], [right]) => left.localeCompare(right),
        ),
      ),
    ),
  );
}

function validateArtifactPayload(payload: Uint8Array) {
  if (payload.byteLength === 0) {
    throw new SessionImportStorageError(
      "The session capsule artifact is empty.",
    );
  }
  if (payload.byteLength > MAX_STORED_SESSION_CAPSULE_BYTES) {
    throw new SessionImportStorageError(
      "The session capsule artifact exceeds the 32 MiB storage limit.",
      413,
      "session_import_too_large",
    );
  }
}

export async function encryptSessionImportArtifact(input: {
  scope: SessionImportArtifactScope;
  payload: Uint8Array;
  expectedSha256: string;
}) {
  validateArtifactPayload(input.payload);
  const digest = sha256(input.payload);
  if (digest !== input.expectedSha256) {
    throw new SessionImportStorageError(
      "The session capsule checksum does not match its content.",
      400,
      "session_import_checksum_mismatch",
    );
  }
  const encoded = JSON.stringify({
    version: 1,
    context: artifactContextFingerprint(input.scope),
    payload: Buffer.from(input.payload).toString("base64url"),
  });
  return {
    encryptedPayload: await encryptSecret(
      encoded,
      artifactEncryptionContext(input.scope),
    ),
    plaintextSha256: digest,
    plaintextBytes: input.payload.byteLength,
  };
}

export async function decryptSessionImportArtifact(input: {
  scope: SessionImportArtifactScope;
  encryptedPayload: string;
  plaintextSha256: string;
  plaintextBytes: number;
}) {
  if (
    input.plaintextBytes <= 0 ||
    input.plaintextBytes > MAX_STORED_SESSION_CAPSULE_BYTES
  ) {
    throw new SessionImportStorageError(
      "The stored session capsule has invalid size metadata.",
      500,
      "session_import_integrity_failure",
    );
  }
  const encoded = await decryptSecret(
    input.encryptedPayload,
    artifactEncryptionContext(input.scope),
  );
  let envelope: { version?: unknown; context?: unknown; payload?: unknown };
  try {
    envelope = JSON.parse(encoded) as typeof envelope;
  } catch {
    throw new SessionImportStorageError(
      "The stored session capsule failed integrity verification.",
      500,
      "session_import_integrity_failure",
    );
  }
  if (
    envelope.version !== 1 ||
    envelope.context !== artifactContextFingerprint(input.scope) ||
    typeof envelope.payload !== "string"
  ) {
    throw new SessionImportStorageError(
      "The stored session capsule failed integrity verification.",
      500,
      "session_import_integrity_failure",
    );
  }
  const payload = new Uint8Array(Buffer.from(envelope.payload, "base64url"));
  if (
    payload.byteLength !== input.plaintextBytes ||
    sha256(payload) !== input.plaintextSha256
  ) {
    throw new SessionImportStorageError(
      "The stored session capsule failed integrity verification.",
      500,
      "session_import_integrity_failure",
    );
  }
  return payload;
}

export class PostgresSessionImportArtifactStore implements SessionImportArtifactStore {
  constructor(private readonly database: Database = getDatabase()) {}

  private async requireImport(scope: SessionImportArtifactScope) {
    const [record] = await this.database
      .select({ id: schema.agentSessionImports.id })
      .from(schema.agentSessionImports)
      .where(
        and(
          eq(schema.agentSessionImports.id, scope.importId),
          eq(schema.agentSessionImports.organizationId, scope.organizationId),
          eq(schema.agentSessionImports.workspaceId, scope.workspaceId),
          eq(schema.agentSessionImports.importedBy, scope.importedBy),
          isNull(schema.agentSessionImports.deletedAt),
        ),
      )
      .limit(1);
    if (!record) {
      throw new SessionImportStorageError(
        "The session import was not found.",
        404,
        "session_import_not_found",
      );
    }
  }

  async put(input: {
    scope: SessionImportArtifactScope;
    payload: Uint8Array;
    mediaType: string;
    expectedSha256: string;
  }) {
    await this.requireImport(input.scope);
    const sealed = await encryptSessionImportArtifact(input);
    const [created] = await this.database
      .insert(schema.agentSessionImportArtifacts)
      .values({
        importId: input.scope.importId,
        mediaType: input.mediaType,
        plaintextSha256: sealed.plaintextSha256,
        plaintextBytes: sealed.plaintextBytes,
        encryptedPayload: sealed.encryptedPayload,
      })
      .onConflictDoNothing({
        target: schema.agentSessionImportArtifacts.importId,
      })
      .returning({ importId: schema.agentSessionImportArtifacts.importId });

    if (created) {
      return {
        created: true,
        sha256: sealed.plaintextSha256,
        bytes: sealed.plaintextBytes,
      };
    }

    const [existing] = await this.database
      .select({
        mediaType: schema.agentSessionImportArtifacts.mediaType,
        sha256: schema.agentSessionImportArtifacts.plaintextSha256,
        bytes: schema.agentSessionImportArtifacts.plaintextBytes,
      })
      .from(schema.agentSessionImportArtifacts)
      .where(
        eq(schema.agentSessionImportArtifacts.importId, input.scope.importId),
      )
      .limit(1);
    if (
      !existing ||
      existing.mediaType !== input.mediaType ||
      existing.sha256 !== sealed.plaintextSha256 ||
      existing.bytes !== sealed.plaintextBytes
    ) {
      throw new SessionImportStorageError(
        "This import already has a different capsule artifact.",
        409,
        "session_import_artifact_conflict",
      );
    }
    return { created: false, sha256: existing.sha256, bytes: existing.bytes };
  }

  async get(scope: SessionImportArtifactScope) {
    const [artifact] = await this.database
      .select({
        mediaType: schema.agentSessionImportArtifacts.mediaType,
        encryptedPayload: schema.agentSessionImportArtifacts.encryptedPayload,
        plaintextSha256: schema.agentSessionImportArtifacts.plaintextSha256,
        plaintextBytes: schema.agentSessionImportArtifacts.plaintextBytes,
      })
      .from(schema.agentSessionImportArtifacts)
      .innerJoin(
        schema.agentSessionImports,
        and(
          eq(
            schema.agentSessionImports.id,
            schema.agentSessionImportArtifacts.importId,
          ),
          eq(schema.agentSessionImports.organizationId, scope.organizationId),
          eq(schema.agentSessionImports.workspaceId, scope.workspaceId),
          eq(schema.agentSessionImports.importedBy, scope.importedBy),
          isNull(schema.agentSessionImports.deletedAt),
        ),
      )
      .where(eq(schema.agentSessionImportArtifacts.importId, scope.importId))
      .limit(1);
    if (!artifact) return null;
    return {
      payload: await decryptSessionImportArtifact({ scope, ...artifact }),
      mediaType: artifact.mediaType,
      sha256: artifact.plaintextSha256,
      bytes: artifact.plaintextBytes,
    };
  }

  async delete(scope: SessionImportArtifactScope) {
    await this.requireImport(scope);
    const [deleted] = await this.database
      .delete(schema.agentSessionImportArtifacts)
      .where(eq(schema.agentSessionImportArtifacts.importId, scope.importId))
      .returning({ importId: schema.agentSessionImportArtifacts.importId });
    return Boolean(deleted);
  }
}

function validateIdempotencyKey(value: string) {
  const key = value.trim();
  if (!key || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new SessionImportStorageError(
      "The session import idempotency key is invalid.",
      400,
      "session_import_invalid_idempotency_key",
    );
  }
  return key;
}

export function assertMatchingIdempotentImport(
  existingSha256: string,
  incomingSha256: string,
) {
  if (existingSha256 !== incomingSha256) {
    throw new SessionImportStorageError(
      "This idempotency key was already used for different capsule content.",
      409,
      "session_import_idempotency_conflict",
    );
  }
}

export function resolveStoredImportStatus(
  current: (typeof schema.agentSessionImportStatus.enumValues)[number],
) {
  return current === "storing" || current === "failed" ? "stored" : current;
}

async function resolveImportScope(
  database: Database,
  workspaceId: string,
  importedBy: string,
) {
  const [scope] = await database
    .select({ organizationId: schema.workspaces.organizationId })
    .from(schema.workspaces)
    .innerJoin(
      schema.workspaceMembers,
      and(
        eq(schema.workspaceMembers.workspaceId, schema.workspaces.id),
        eq(schema.workspaceMembers.userId, importedBy),
      ),
    )
    .where(
      and(
        eq(schema.workspaces.id, workspaceId),
        isNull(schema.workspaces.deletedAt),
      ),
    )
    .limit(1);
  if (!scope) {
    throw new SessionImportStorageError(
      "The workspace was not found.",
      404,
      "session_import_workspace_not_found",
    );
  }
  return scope;
}

async function validateParentImport(
  database: Database,
  input: {
    parentImportId: string | undefined;
    organizationId: string;
    workspaceId: string;
    importedBy: string;
  },
) {
  if (!input.parentImportId) return;
  const [parent] = await database
    .select({ id: schema.agentSessionImports.id })
    .from(schema.agentSessionImports)
    .where(
      and(
        eq(schema.agentSessionImports.id, input.parentImportId),
        eq(schema.agentSessionImports.organizationId, input.organizationId),
        eq(schema.agentSessionImports.workspaceId, input.workspaceId),
        eq(schema.agentSessionImports.importedBy, input.importedBy),
        isNull(schema.agentSessionImports.deletedAt),
      ),
    )
    .limit(1);
  if (!parent) {
    throw new SessionImportStorageError(
      "The parent session import was not found.",
      404,
      "session_import_parent_not_found",
    );
  }
}

export async function storeSessionImport(
  input: {
    workspaceId: string;
    importedBy: string;
    idempotencyKey: string;
    capsule: SessionCapsuleV0;
    artifact: Uint8Array;
    parentImportId?: string;
  },
  dependencies: {
    database?: Database;
    artifactStore?: SessionImportArtifactStore;
    appendEvent?: AppendWorkspaceEvent;
  } = {},
) {
  const database = dependencies.database ?? getDatabase();
  const artifactStore =
    dependencies.artifactStore ??
    new PostgresSessionImportArtifactStore(database);
  const capsule = sessionCapsuleV0Schema.parse(input.capsule);
  validateArtifactPayload(input.artifact);
  const digest = sha256(input.artifact);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const { organizationId } = await resolveImportScope(
    database,
    input.workspaceId,
    input.importedBy,
  );
  await validateParentImport(database, {
    parentImportId: input.parentImportId,
    organizationId,
    workspaceId: input.workspaceId,
    importedBy: input.importedBy,
  });
  const importId = randomUUID();
  const [created] = await database
    .insert(schema.agentSessionImports)
    .values({
      id: importId,
      organizationId,
      workspaceId: input.workspaceId,
      importedBy: input.importedBy,
      parentImportId: input.parentImportId,
      sourceProvider: capsule.source.provider,
      externalSessionId: capsule.source.externalSessionId,
      capsuleSchemaVersion: capsule.schemaVersion,
      capsuleSha256: digest,
      idempotencyKey,
      status: "storing",
    })
    .onConflictDoNothing({
      target: [
        schema.agentSessionImports.workspaceId,
        schema.agentSessionImports.importedBy,
        schema.agentSessionImports.idempotencyKey,
      ],
    })
    .returning({
      id: schema.agentSessionImports.id,
      capsuleSha256: schema.agentSessionImports.capsuleSha256,
      status: schema.agentSessionImports.status,
      parentImportId: schema.agentSessionImports.parentImportId,
    });

  const record =
    created ??
    (
      await database
        .select({
          id: schema.agentSessionImports.id,
          capsuleSha256: schema.agentSessionImports.capsuleSha256,
          status: schema.agentSessionImports.status,
          parentImportId: schema.agentSessionImports.parentImportId,
        })
        .from(schema.agentSessionImports)
        .where(
          and(
            eq(schema.agentSessionImports.workspaceId, input.workspaceId),
            eq(schema.agentSessionImports.importedBy, input.importedBy),
            eq(schema.agentSessionImports.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1)
    )[0];
  if (!record) {
    throw new SessionImportStorageError(
      "The session import could not be created.",
      500,
    );
  }
  assertMatchingIdempotentImport(record.capsuleSha256, digest);
  if (record.parentImportId !== (input.parentImportId ?? null)) {
    throw new SessionImportStorageError(
      "This idempotency key was already used with different import lineage.",
      409,
      "session_import_idempotency_conflict",
    );
  }
  if (record.status === "deleted") {
    return { importId: record.id, created: false, status: record.status };
  }

  const scope = {
    organizationId,
    workspaceId: input.workspaceId,
    importId: record.id,
    importedBy: input.importedBy,
  };
  try {
    const artifact = await artifactStore.put({
      scope,
      payload: input.artifact,
      mediaType: SESSION_CAPSULE_ARTIFACT_MEDIA_TYPE,
      expectedSha256: digest,
    });
    const storedStatus = resolveStoredImportStatus(record.status);
    const canAdvanceToStored =
      storedStatus === "stored" && record.status !== "stored";
    if (canAdvanceToStored) {
      await database
        .update(schema.agentSessionImports)
        .set({ status: "stored", lastError: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.agentSessionImports.id, record.id),
            inArray(schema.agentSessionImports.status, ["storing", "failed"]),
          ),
        );
    }
    if (artifact.created) {
      await (dependencies.appendEvent ?? appendWorkspaceEvent)({
        workspaceId: input.workspaceId,
        actorId: input.importedBy,
        type: "agent_session_import.stored",
        payload: {
          importId: record.id,
          sourceProvider: capsule.source.provider,
          capsuleSchemaVersion: capsule.schemaVersion,
          bytes: artifact.bytes,
        },
      });
    }
    return {
      importId: record.id,
      created: Boolean(created),
      status: storedStatus,
    };
  } catch (error) {
    if (record.status === "storing" || record.status === "failed") {
      await database
        .update(schema.agentSessionImports)
        .set({
          status: "failed",
          lastError: "Capsule artifact storage failed.",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.agentSessionImports.id, record.id),
            inArray(schema.agentSessionImports.status, ["storing", "failed"]),
          ),
        );
    }
    throw error;
  }
}

export async function readSessionImportArtifact(
  scope: SessionImportArtifactScope,
  store: SessionImportArtifactStore = new PostgresSessionImportArtifactStore(),
) {
  return store.get(scope);
}

export async function deleteSessionImport(
  scope: SessionImportArtifactScope,
  dependencies: {
    database?: Database;
    artifactStore?: SessionImportArtifactStore;
    appendEvent?: AppendWorkspaceEvent;
  } = {},
) {
  const database = dependencies.database ?? getDatabase();
  const artifactStore =
    dependencies.artifactStore ??
    new PostgresSessionImportArtifactStore(database);
  const [record] = await database
    .select({ id: schema.agentSessionImports.id })
    .from(schema.agentSessionImports)
    .where(
      and(
        eq(schema.agentSessionImports.id, scope.importId),
        eq(schema.agentSessionImports.organizationId, scope.organizationId),
        eq(schema.agentSessionImports.workspaceId, scope.workspaceId),
        eq(schema.agentSessionImports.importedBy, scope.importedBy),
        isNull(schema.agentSessionImports.deletedAt),
      ),
    )
    .limit(1);
  if (!record) return false;

  await artifactStore.delete(scope);
  const now = new Date();
  await database
    .update(schema.agentSessionImports)
    .set({ status: "deleted", deletedAt: now, updatedAt: now })
    .where(eq(schema.agentSessionImports.id, scope.importId));
  await (dependencies.appendEvent ?? appendWorkspaceEvent)({
    workspaceId: scope.workspaceId,
    actorId: scope.importedBy,
    type: "agent_session_import.deleted",
    payload: { importId: scope.importId },
  });
  return true;
}

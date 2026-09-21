import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import {
  readSessionImportArtifact,
  sessionCapsuleSha256,
  SESSION_CAPSULE_ARTIFACT_MEDIA_TYPE,
  SessionImportStorageError,
} from "./session-import-storage";
import { decodeSessionCapsuleTransport } from "./session-capsule-transport";

type Database = ReturnType<typeof getDatabase>;

export async function listStoredSessionImports(
  input: { workspaceId: string; importedBy: string },
  database: Database = getDatabase(),
) {
  return database
    .select({
      id: schema.agentSessionImports.id,
      sourceProvider: schema.agentSessionImports.sourceProvider,
      externalSessionId: schema.agentSessionImports.externalSessionId,
      status: schema.agentSessionImports.status,
      repositoryStatus: schema.agentSessionImports.repositoryStatus,
      createdAt: schema.agentSessionImports.createdAt,
    })
    .from(schema.agentSessionImports)
    .where(
      and(
        eq(schema.agentSessionImports.workspaceId, input.workspaceId),
        eq(schema.agentSessionImports.importedBy, input.importedBy),
        isNull(schema.agentSessionImports.deletedAt),
      ),
    )
    .orderBy(desc(schema.agentSessionImports.createdAt))
    .limit(100);
}

export async function readStoredSessionImportView(
  input: { workspaceId: string; importId: string; importedBy: string },
  dependencies: {
    database?: Database;
    readArtifact?: typeof readSessionImportArtifact;
  } = {},
) {
  const database = dependencies.database ?? getDatabase();
  const [record] = await database
    .select({
      organizationId: schema.agentSessionImports.organizationId,
      status: schema.agentSessionImports.status,
      repositoryStatus: schema.agentSessionImports.repositoryStatus,
      worktreeId: schema.agentSessionImports.worktreeId,
      agentSessionId: schema.agentSessionImports.agentSessionId,
      capsuleSha256: schema.agentSessionImports.capsuleSha256,
      createdAt: schema.agentSessionImports.createdAt,
    })
    .from(schema.agentSessionImports)
    .where(
      and(
        eq(schema.agentSessionImports.id, input.importId),
        eq(schema.agentSessionImports.workspaceId, input.workspaceId),
        eq(schema.agentSessionImports.importedBy, input.importedBy),
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

  const artifact = await (
    dependencies.readArtifact ?? readSessionImportArtifact
  )({
    organizationId: record.organizationId,
    workspaceId: input.workspaceId,
    importId: input.importId,
    importedBy: input.importedBy,
  });
  if (!artifact || artifact.mediaType !== SESSION_CAPSULE_ARTIFACT_MEDIA_TYPE) {
    throw new SessionImportStorageError(
      "The stored session capsule is unavailable.",
      500,
      "session_import_artifact_unavailable",
    );
  }
  const { capsule } = decodeSessionCapsuleTransport(artifact.payload);
  if (sessionCapsuleSha256(capsule) !== record.capsuleSha256) {
    throw new SessionImportStorageError(
      "The stored session capsule failed integrity verification.",
      500,
      "session_import_integrity_failure",
    );
  }

  return {
    id: input.importId,
    status: record.status,
    repositoryStatus: record.repositoryStatus,
    worktreeId: record.worktreeId,
    agentSessionId: record.agentSessionId,
    createdAt: record.createdAt,
    source: {
      provider: capsule.source.provider,
      externalSessionId: capsule.source.externalSessionId,
    },
    repository: capsule.repository,
    handoff: capsule.handoff,
    transcript: {
      totalEntries: capsule.transcript.length,
      entries: capsule.transcript.slice(-50),
    },
  };
}

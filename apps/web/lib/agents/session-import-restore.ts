import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { ensureWorkspaceRuntimeReady } from "../runtime/runtime-resume";
import {
  transitionSessionImport,
  transitionSessionImportRepository,
  SessionImportLifecycleError,
  type SessionImportLifecycleScope,
} from "./session-import-lifecycle";
import {
  readSessionImportArtifact,
  sessionCapsuleSha256,
  SESSION_CAPSULE_ARTIFACT_MEDIA_TYPE,
} from "./session-import-storage";
import { decodeSessionCapsuleTransport } from "./session-capsule-transport";
import { restoreSessionRepository } from "./session-repository-restoration";
import { createSandboxSessionRepositoryRuntime } from "./session-repository-sandbox-runtime";

type Database = ReturnType<typeof getDatabase>;

export class SessionImportRestoreError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly code = "session_import_restore_error",
  ) {
    super(message);
    this.name = "SessionImportRestoreError";
  }
}

/** The authenticated, importer-scoped control-plane entry to repository restore. */
export async function restoreStoredSessionImport(
  input: {
    workspaceId: string;
    importId: string;
    importedBy: string;
    transcriptOnly?: boolean;
  },
  dependencies: {
    database?: Database;
    readArtifact?: typeof readSessionImportArtifact;
    ensureRuntime?: typeof ensureWorkspaceRuntimeReady;
    restore?: typeof restoreSessionRepository;
    runtime?: ReturnType<typeof createSandboxSessionRepositoryRuntime>;
    transitionImport?: typeof transitionSessionImport;
    transitionRepository?: typeof transitionSessionImportRepository;
  } = {},
) {
  const database = dependencies.database ?? getDatabase();
  const [record] = await database
    .select({
      organizationId: schema.agentSessionImports.organizationId,
      status: schema.agentSessionImports.status,
      repositoryStatus: schema.agentSessionImports.repositoryStatus,
      capsuleSha256: schema.agentSessionImports.capsuleSha256,
      worktreeId: schema.agentSessionImports.worktreeId,
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
    throw new SessionImportRestoreError(
      "The session import was not found.",
      404,
      "session_import_not_found",
    );
  }

  const scope: SessionImportLifecycleScope = {
    organizationId: record.organizationId,
    workspaceId: input.workspaceId,
    importId: input.importId,
    importedBy: input.importedBy,
  };
  const transitionImport =
    dependencies.transitionImport ?? transitionSessionImport;
  const transitionRepository =
    dependencies.transitionRepository ?? transitionSessionImportRepository;

  if (record.status === "ready") {
    if (input.transcriptOnly && record.repositoryStatus !== "transcript_only") {
      throw new SessionImportRestoreError(
        "A completed repository restore cannot be changed to transcript-only.",
      );
    }
    return {
      status: "ready" as const,
      repositoryStatus: record.repositoryStatus,
      worktreeId: record.worktreeId,
    };
  }
  if (record.status !== "stored" && record.status !== "restoring") {
    throw new SessionImportLifecycleError(
      "Only a stored or restoring import can be restored.",
      409,
      "session_import_not_restorable",
    );
  }

  if (input.transcriptOnly) {
    if (
      record.status !== "restoring" ||
      (record.repositoryStatus !== "conflicted" &&
        record.repositoryStatus !== "unavailable")
    ) {
      throw new SessionImportRestoreError(
        "Transcript-only continuation requires a recorded repository conflict or unavailability.",
      );
    }
    await transitionRepository({ scope, to: "transcript_only" });
    await transitionImport({ scope, to: "ready" });
    return {
      status: "ready" as const,
      repositoryStatus: "transcript_only" as const,
      worktreeId: null,
    };
  }

  if (record.status === "stored") {
    await transitionImport({ scope, to: "restoring" });
  }

  if (
    record.repositoryStatus === "matched" ||
    record.repositoryStatus === "restored"
  ) {
    await transitionImport({ scope, to: "ready" });
    return {
      status: "ready" as const,
      repositoryStatus: record.repositoryStatus,
      worktreeId: record.worktreeId,
    };
  }
  const artifact = await (
    dependencies.readArtifact ?? readSessionImportArtifact
  )(scope);
  if (!artifact || artifact.mediaType !== SESSION_CAPSULE_ARTIFACT_MEDIA_TYPE) {
    throw new SessionImportRestoreError(
      "The stored session capsule is missing or has an unsupported format.",
      500,
      "session_import_artifact_unavailable",
    );
  }
  const decoded = decodeSessionCapsuleTransport(artifact.payload);
  if (sessionCapsuleSha256(decoded.capsule) !== record.capsuleSha256) {
    throw new SessionImportRestoreError(
      "The stored session capsule identity failed verification.",
      500,
      "session_import_integrity_failure",
    );
  }
  await (dependencies.ensureRuntime ?? ensureWorkspaceRuntimeReady)(
    input.workspaceId,
    input.importedBy,
    "coSteer",
  );
  const result = await (dependencies.restore ?? restoreSessionRepository)({
    workspaceId: input.workspaceId,
    importId: input.importId,
    decoded,
    runtime: dependencies.runtime ?? createSandboxSessionRepositoryRuntime(),
  });
  if (result.status === "transcript_only") {
    throw new SessionImportRestoreError(
      "Repository restore cannot choose transcript-only continuation implicitly.",
      500,
    );
  }
  await transitionRepository({ scope, to: result.status });
  if (result.status === "matched" || result.status === "restored") {
    await transitionImport({ scope, to: "ready" });
    return {
      status: "ready" as const,
      repositoryStatus: result.status,
      worktreeId: result.worktreeId,
    };
  }
  return {
    status: "restoring" as const,
    repositoryStatus: result.status,
    worktreeId: null,
    ...(result.status === "conflicted"
      ? { conflictPaths: result.conflictPaths }
      : { reason: result.reason }),
  };
}

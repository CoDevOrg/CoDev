import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { appendWorkspaceEvent } from "../workspaces/audit";

type Database = ReturnType<typeof getDatabase>;
type AppendWorkspaceEvent = typeof appendWorkspaceEvent;

export type SessionImportStatus =
  (typeof schema.agentSessionImportStatus.enumValues)[number];
export type SessionImportRepositoryStatus =
  (typeof schema.repositoryRestoreStatus.enumValues)[number];
export type SessionImportContinuationMode =
  (typeof schema.sessionContinuationMode.enumValues)[number];

export type SessionImportLifecycleScope = {
  organizationId: string;
  workspaceId: string;
  importId: string;
  importedBy: string;
};

export class SessionImportLifecycleError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly code = "session_import_invalid_transition",
  ) {
    super(message);
    this.name = "SessionImportLifecycleError";
  }
}

const importTransitions: Record<
  SessionImportStatus,
  readonly SessionImportStatus[]
> = {
  storing: ["stored", "failed", "deleted"],
  stored: ["restoring", "failed", "deleted"],
  restoring: ["ready", "failed", "deleted"],
  ready: ["launching", "failed", "deleted"],
  launching: ["active", "ready", "failed", "deleted"],
  active: ["ready", "failed", "deleted"],
  failed: ["deleted"],
  deleted: [],
};

const repositoryTransitions: Record<
  SessionImportRepositoryStatus,
  readonly SessionImportRepositoryStatus[]
> = {
  pending: [
    "matched",
    "restored",
    "conflicted",
    "unavailable",
    "transcript_only",
  ],
  matched: ["restored", "conflicted", "unavailable", "transcript_only"],
  restored: [],
  conflicted: ["restored", "unavailable", "transcript_only"],
  unavailable: ["transcript_only"],
  transcript_only: [],
};

export function assertSessionImportTransition(
  from: SessionImportStatus,
  to: SessionImportStatus,
) {
  if (from === to) return;
  if (!importTransitions[from].includes(to)) {
    throw new SessionImportLifecycleError(
      `A session import cannot transition from ${from} to ${to}.`,
    );
  }
}

export function assertRepositoryRestoreTransition(
  from: SessionImportRepositoryStatus,
  to: SessionImportRepositoryStatus,
) {
  if (from === to) return;
  if (!repositoryTransitions[from].includes(to)) {
    throw new SessionImportLifecycleError(
      `Repository restoration cannot transition from ${from} to ${to}.`,
      409,
      "session_import_invalid_repository_transition",
    );
  }
}

export function assertRepositoryReady(
  repositoryStatus: SessionImportRepositoryStatus,
) {
  if (
    repositoryStatus !== "matched" &&
    repositoryStatus !== "restored" &&
    repositoryStatus !== "transcript_only"
  ) {
    throw new SessionImportLifecycleError(
      `An import with repository status ${repositoryStatus} is not ready.`,
      409,
      "session_import_repository_not_ready",
    );
  }
}

function scopedImportWhere(scope: SessionImportLifecycleScope) {
  return and(
    eq(schema.agentSessionImports.id, scope.importId),
    eq(schema.agentSessionImports.organizationId, scope.organizationId),
    eq(schema.agentSessionImports.workspaceId, scope.workspaceId),
    eq(schema.agentSessionImports.importedBy, scope.importedBy),
    isNull(schema.agentSessionImports.deletedAt),
  );
}

function errorProperty(error: unknown, property: "code" | "constraint") {
  let candidate = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!candidate || typeof candidate !== "object") return undefined;
    const record = candidate as Record<string, unknown>;
    if (typeof record[property] === "string") return record[property];
    candidate = record.cause;
  }
  return undefined;
}

function isActiveWriterConflict(error: unknown) {
  return (
    errorProperty(error, "code") === "23505" &&
    errorProperty(error, "constraint") ===
      "agent_session_imports_active_writer_idx"
  );
}

export async function transitionSessionImport(
  input: {
    scope: SessionImportLifecycleScope;
    to: Exclude<SessionImportStatus, "deleted">;
  },
  dependencies: {
    database?: Database;
    appendEvent?: AppendWorkspaceEvent;
  } = {},
) {
  const database = dependencies.database ?? getDatabase();
  const [record] = await database
    .select({
      status: schema.agentSessionImports.status,
      repositoryStatus: schema.agentSessionImports.repositoryStatus,
      continuationMode: schema.agentSessionImports.continuationMode,
    })
    .from(schema.agentSessionImports)
    .where(scopedImportWhere(input.scope))
    .limit(1);
  if (!record) {
    throw new SessionImportLifecycleError(
      "The session import was not found.",
      404,
      "session_import_not_found",
    );
  }

  assertSessionImportTransition(record.status, input.to);
  if (record.status === input.to) {
    return { changed: false, status: record.status };
  }
  if (input.to === "ready") {
    assertRepositoryReady(record.repositoryStatus);
  }
  if (input.to === "launching" && !record.continuationMode) {
    throw new SessionImportLifecycleError(
      "A continuation mode must be selected before launch.",
      409,
      "session_import_continuation_not_selected",
    );
  }

  try {
    const [updated] = await database
      .update(schema.agentSessionImports)
      .set({
        status: input.to,
        lastError:
          input.to === "failed" ? "Session import operation failed." : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          scopedImportWhere(input.scope),
          eq(schema.agentSessionImports.status, record.status),
        ),
      )
      .returning({ status: schema.agentSessionImports.status });
    if (!updated) {
      throw new SessionImportLifecycleError(
        "The session import changed while its transition was being applied.",
        409,
        "session_import_transition_conflict",
      );
    }
  } catch (error) {
    if (isActiveWriterConflict(error)) {
      throw new SessionImportLifecycleError(
        "This native provider session already has an active writer.",
        409,
        "session_import_active_writer_conflict",
      );
    }
    throw error;
  }

  await (dependencies.appendEvent ?? appendWorkspaceEvent)({
    workspaceId: input.scope.workspaceId,
    actorId: input.scope.importedBy,
    type: "agent_session_import.status_changed",
    payload: {
      importId: input.scope.importId,
      from: record.status,
      to: input.to,
    },
  });
  return { changed: true, status: input.to };
}

export async function transitionSessionImportRepository(
  input: {
    scope: SessionImportLifecycleScope;
    to: SessionImportRepositoryStatus;
  },
  dependencies: {
    database?: Database;
    appendEvent?: AppendWorkspaceEvent;
  } = {},
) {
  const database = dependencies.database ?? getDatabase();
  const [record] = await database
    .select({
      status: schema.agentSessionImports.status,
      repositoryStatus: schema.agentSessionImports.repositoryStatus,
    })
    .from(schema.agentSessionImports)
    .where(scopedImportWhere(input.scope))
    .limit(1);
  if (!record) {
    throw new SessionImportLifecycleError(
      "The session import was not found.",
      404,
      "session_import_not_found",
    );
  }

  assertRepositoryRestoreTransition(record.repositoryStatus, input.to);
  if (record.repositoryStatus === input.to) {
    return { changed: false, repositoryStatus: record.repositoryStatus };
  }
  if (record.status !== "restoring") {
    throw new SessionImportLifecycleError(
      "Repository state can only change while the import is restoring.",
      409,
      "session_import_not_restoring",
    );
  }

  const [updated] = await database
    .update(schema.agentSessionImports)
    .set({ repositoryStatus: input.to, updatedAt: new Date() })
    .where(
      and(
        scopedImportWhere(input.scope),
        eq(schema.agentSessionImports.status, "restoring"),
        eq(
          schema.agentSessionImports.repositoryStatus,
          record.repositoryStatus,
        ),
      ),
    )
    .returning({
      repositoryStatus: schema.agentSessionImports.repositoryStatus,
    });
  if (!updated) {
    throw new SessionImportLifecycleError(
      "The repository state changed while its transition was being applied.",
      409,
      "session_import_transition_conflict",
    );
  }

  await (dependencies.appendEvent ?? appendWorkspaceEvent)({
    workspaceId: input.scope.workspaceId,
    actorId: input.scope.importedBy,
    type: "agent_session_import.repository_status_changed",
    payload: {
      importId: input.scope.importId,
      from: record.repositoryStatus,
      to: input.to,
    },
  });
  return { changed: true, repositoryStatus: input.to };
}

export async function selectSessionImportContinuation(
  input: {
    scope: SessionImportLifecycleScope;
    mode: SessionImportContinuationMode;
  },
  dependencies: {
    database?: Database;
    appendEvent?: AppendWorkspaceEvent;
  } = {},
) {
  const database = dependencies.database ?? getDatabase();
  const [record] = await database
    .select({
      status: schema.agentSessionImports.status,
      continuationMode: schema.agentSessionImports.continuationMode,
    })
    .from(schema.agentSessionImports)
    .where(scopedImportWhere(input.scope))
    .limit(1);
  if (!record) {
    throw new SessionImportLifecycleError(
      "The session import was not found.",
      404,
      "session_import_not_found",
    );
  }
  if (record.continuationMode === input.mode) {
    return { changed: false, continuationMode: record.continuationMode };
  }
  if (record.status !== "ready") {
    throw new SessionImportLifecycleError(
      "Continuation can only be selected while the import is ready.",
      409,
      "session_import_not_ready",
    );
  }

  const continuationPredicate = record.continuationMode
    ? eq(schema.agentSessionImports.continuationMode, record.continuationMode)
    : isNull(schema.agentSessionImports.continuationMode);
  const [updated] = await database
    .update(schema.agentSessionImports)
    .set({ continuationMode: input.mode, updatedAt: new Date() })
    .where(
      and(
        scopedImportWhere(input.scope),
        eq(schema.agentSessionImports.status, "ready"),
        continuationPredicate,
      ),
    )
    .returning({
      continuationMode: schema.agentSessionImports.continuationMode,
    });
  if (!updated) {
    throw new SessionImportLifecycleError(
      "The continuation choice changed while it was being applied.",
      409,
      "session_import_transition_conflict",
    );
  }

  await (dependencies.appendEvent ?? appendWorkspaceEvent)({
    workspaceId: input.scope.workspaceId,
    actorId: input.scope.importedBy,
    type: "agent_session_import.continuation_selected",
    payload: {
      importId: input.scope.importId,
      mode: input.mode,
    },
  });
  return { changed: true, continuationMode: input.mode };
}

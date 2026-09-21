import "server-only";

import { randomUUID } from "node:crypto";

import { and, countDistinct, eq, isNull, sql } from "drizzle-orm";

import type { SessionCapsuleV0, SessionProvider } from "@codev/contracts";
import { schema } from "@codev/db";
import type { AuthProvider } from "@codev/shared-types";

import { getDatabase } from "../platform/database";
import { getAgentModel } from "../providers/ai-model";
import {
  createSandboxWorktree,
  deleteSandboxWorktree,
} from "../runtime/orchestrator";
import { ensureWorkspaceRuntimeReady } from "../runtime/runtime-resume";
import { appendWorkspaceEvent } from "../workspaces/audit";
import {
  assertAgentCapacity,
  managedLiveAgentWorktreePredicate,
} from "./agent-capacity";
import { decodeSessionCapsuleTransport } from "./session-capsule-transport";
import {
  type SessionImportLifecycleScope,
  SessionImportLifecycleError,
  selectSessionImportContinuation,
  transitionSessionImportRepository,
  transitionSessionImport,
} from "./session-import-lifecycle";
import {
  readSessionImportArtifact,
  sessionCapsuleSha256,
  SESSION_CAPSULE_ARTIFACT_MEDIA_TYPE,
  SessionImportStorageError,
} from "./session-import-storage";
import { importedTranscriptToTurns } from "./session-import-transcript-turns";

type Database = ReturnType<typeof getDatabase>;

function agentProvider(provider: SessionProvider): AuthProvider {
  switch (provider) {
    case "codex":
      return "openai";
    case "claude":
      return "anthropic";
    case "cursor":
      return "cursor";
  }
}

function sessionName(capsule: SessionCapsuleV0) {
  const provider =
    capsule.source.provider[0]!.toUpperCase() +
    capsule.source.provider.slice(1);
  return `${provider} continuation`;
}

export async function continueStoredSessionImport(
  input: {
    workspaceId: string;
    importId: string;
    importedBy: string;
    chatOnly?: boolean;
  },
  dependencies: {
    database?: Database;
    readArtifact?: typeof readSessionImportArtifact;
    selectContinuation?: typeof selectSessionImportContinuation;
    transitionImport?: typeof transitionSessionImport;
    transitionRepository?: typeof transitionSessionImportRepository;
    appendEvent?: typeof appendWorkspaceEvent;
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
    throw new SessionImportLifecycleError(
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
  if (input.chatOnly && !record.agentSessionId) {
    if (record.status === "stored") {
      await (dependencies.transitionImport ?? transitionSessionImport)({
        scope,
        to: "restoring",
      });
    }
    if (record.status === "stored" || record.status === "restoring") {
      if (record.repositoryStatus !== "transcript_only") {
        await (
          dependencies.transitionRepository ?? transitionSessionImportRepository
        )({
          scope,
          to: "transcript_only",
        });
      }
      await (dependencies.transitionImport ?? transitionSessionImport)({
        scope,
        to: "ready",
      });
    }
  }
  if (record.agentSessionId) {
    if (record.status === "launching") {
      await (dependencies.transitionImport ?? transitionSessionImport)({
        scope,
        to: "active",
      });
    }
    return { sessionId: record.agentSessionId, created: false };
  }
  if (record.status !== "ready" && !input.chatOnly) {
    throw new SessionImportLifecycleError(
      "Restore the imported repository before continuing in CoDev.",
      409,
      "session_import_not_ready",
    );
  }
  if (
    (!input.chatOnly && !record.worktreeId) ||
    (!input.chatOnly &&
      record.repositoryStatus !== "matched" &&
      record.repositoryStatus !== "restored")
  ) {
    throw new SessionImportLifecycleError(
      "A restored repository is required to continue this session in CoDev.",
      409,
      "session_import_repository_not_restored",
    );
  }

  const artifact = await (
    dependencies.readArtifact ?? readSessionImportArtifact
  )(scope);
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

  const selectContinuation =
    dependencies.selectContinuation ?? selectSessionImportContinuation;
  const transitionImport =
    dependencies.transitionImport ?? transitionSessionImport;
  await selectContinuation({ scope, mode: "managed" });
  await transitionImport({ scope, to: "launching" });

  let linkedSession = false;
  let createdWorktreeId: string | null = null;
  try {
    const provider = agentProvider(capsule.source.provider);
    const turns = importedTranscriptToTurns(
      capsule.transcript,
      capsule.createdAt,
    );
    const result = await database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`agent-slot:${input.workspaceId}`}))`,
      );
      const [locked] = await transaction
        .select({
          status: schema.agentSessionImports.status,
          worktreeId: schema.agentSessionImports.worktreeId,
          agentSessionId: schema.agentSessionImports.agentSessionId,
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
        .limit(1)
        .for("update");
      if (locked?.agentSessionId) {
        return { sessionId: locked.agentSessionId, created: false };
      }
      if (
        locked?.status !== "launching" ||
        (!input.chatOnly && !locked.worktreeId)
      ) {
        throw new SessionImportLifecycleError(
          "The imported session changed while its continuation was starting.",
          409,
          "session_import_transition_conflict",
        );
      }

      const [worktreeCount] = await transaction
        .select({ value: countDistinct(schema.worktrees.id) })
        .from(schema.agentSessions)
        .innerJoin(
          schema.worktrees,
          eq(schema.agentSessions.worktreeId, schema.worktrees.id),
        )
        .where(managedLiveAgentWorktreePredicate(input.workspaceId));
      assertAgentCapacity(Number(worktreeCount?.value ?? 0));

      let worktreeId = locked.worktreeId;
      let headSha: string | null = null;
      if (input.chatOnly) {
        const [integration] = await transaction
          .select({
            id: schema.worktrees.id,
            headSha: schema.worktrees.headSha,
          })
          .from(schema.worktrees)
          .where(
            and(
              eq(schema.worktrees.workspaceId, input.workspaceId),
              eq(schema.worktrees.kind, "integration"),
              eq(schema.worktrees.status, "active"),
            ),
          )
          .limit(1);
        if (!integration) {
          throw new SessionImportLifecycleError(
            "The workspace repository is not ready for a chat-only continuation.",
            409,
            "workspace_repository_not_ready",
          );
        }
        headSha = integration.headSha;
        const [worktree] = await transaction
          .insert(schema.worktrees)
          .values({
            workspaceId: input.workspaceId,
            kind: "agent",
            name: `agent-chat-import-${randomUUID().slice(0, 8)}`,
            headSha: integration.headSha,
          })
          .returning({ id: schema.worktrees.id });
        if (!worktree) throw new Error("Could not create the chat worktree.");
        worktreeId = worktree.id;
      }
      if (!worktreeId)
        throw new Error("A worktree is required for an agent session.");
      const [session] = await transaction
        .insert(schema.agentSessions)
        .values({
          workspaceId: input.workspaceId,
          worktreeId,
          createdBy: input.importedBy,
          name: sessionName(capsule),
          model: getAgentModel(provider),
          provider,
          status: "idle",
        })
        .returning({ id: schema.agentSessions.id });
      if (!session) throw new Error("Could not create the agent session.");

      for (let index = 0; index < turns.length; index += 100) {
        const batch = turns.slice(index, index + 100).map((turn) => ({
          sessionId: session.id,
          authorId: input.importedBy,
          prompt: turn.prompt,
          output: turn.output,
          status: "completed" as const,
          startedAt: turn.createdAt,
          finishedAt: turn.createdAt,
          createdAt: turn.createdAt,
          updatedAt: turn.createdAt,
        }));
        if (batch.length) {
          await transaction.insert(schema.agentTurns).values(batch);
        }
      }
      await transaction
        .update(schema.agentSessionImports)
        .set({ agentSessionId: session.id, updatedAt: new Date() })
        .where(eq(schema.agentSessionImports.id, input.importId));
      return {
        sessionId: session.id,
        created: true,
        worktreeId,
        headSha,
      };
    });
    createdWorktreeId = result.worktreeId ?? null;
    if (input.chatOnly && result.worktreeId && result.headSha) {
      await ensureWorkspaceRuntimeReady(
        input.workspaceId,
        input.importedBy,
        "coSteer",
      );
      await createSandboxWorktree(
        input.workspaceId,
        result.worktreeId,
        result.headSha,
        `agent/chat-import-${result.worktreeId.slice(0, 8)}`,
      );
    }
    linkedSession = true;

    await transitionImport({ scope, to: "active" });
    if (result.created) {
      await (dependencies.appendEvent ?? appendWorkspaceEvent)({
        workspaceId: input.workspaceId,
        actorId: input.importedBy,
        type: "agent.session_created",
        payload: {
          sessionId: result.sessionId,
          worktreeId: result.worktreeId ?? record.worktreeId,
          provider,
          importedSessionId: input.importId,
          draft: true,
        },
      }).catch(() => undefined);
    }
    return result;
  } catch (error) {
    if (createdWorktreeId && input.chatOnly) {
      await deleteSandboxWorktree(input.workspaceId, createdWorktreeId).catch(
        () => undefined,
      );
      await database
        .delete(schema.worktrees)
        .where(eq(schema.worktrees.id, createdWorktreeId))
        .catch(() => undefined);
    }
    if (!linkedSession) {
      await transitionImport({ scope, to: "ready" }).catch(() => undefined);
    }
    throw error;
  }
}

import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import {
  createSandboxWorktree,
  deleteSandboxWorktree,
  executeInSandbox,
  restoreSandboxSession,
} from "../runtime/orchestrator";
import type {
  RepositoryIdentity,
  SessionRepositoryRuntime,
} from "./session-repository-restoration";

type Database = ReturnType<typeof getDatabase>;

export class SandboxSessionRepositoryRuntime implements SessionRepositoryRuntime {
  constructor(private readonly database: Database = getDatabase()) {}

  async getRepositoryIdentity(
    workspaceId: string,
  ): Promise<RepositoryIdentity | null> {
    const [workspace] = await this.database
      .select({ repository: schema.workspaces.repository })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1);
    if (!workspace?.repository.trim()) return null;
    return { host: "github.com", path: workspace.repository };
  }

  async hasCommit(workspaceId: string, commitSha: string): Promise<boolean> {
    const result = await executeInSandbox(workspaceId, {
      command: ["git", "cat-file", "-e", `${commitSha}^{commit}`],
      timeoutSeconds: 30,
    });
    return result.exitCode === 0;
  }

  async createIsolatedWorktree(input: {
    workspaceId: string;
    importId: string;
    baseCommitSha: string;
  }): Promise<{ worktreeId: string }> {
    const worktree = await this.database.transaction(async (transaction) => {
      const [existingImport] = await transaction
        .select({ worktreeId: schema.agentSessionImports.worktreeId })
        .from(schema.agentSessionImports)
        .where(
          and(
            eq(schema.agentSessionImports.id, input.importId),
            eq(schema.agentSessionImports.workspaceId, input.workspaceId),
            eq(schema.agentSessionImports.status, "restoring"),
            isNull(schema.agentSessionImports.deletedAt),
          ),
        )
        .limit(1);
      if (!existingImport) {
        throw new Error("Session import not found for repository restoration.");
      }
      if (existingImport.worktreeId) {
        const [existingWorktree] = await transaction
          .select({
            id: schema.worktrees.id,
            headSha: schema.worktrees.headSha,
            status: schema.worktrees.status,
          })
          .from(schema.worktrees)
          .where(eq(schema.worktrees.id, existingImport.worktreeId))
          .limit(1);
        if (
          !existingWorktree ||
          existingWorktree.headSha !== input.baseCommitSha
        ) {
          throw new Error(
            "Reserved import worktree does not match the capsule base commit.",
          );
        }
        if (existingWorktree.status !== "discarded") return existingWorktree;
      }

      const previousWorktreeId = existingImport.worktreeId;
      const [created] = await transaction
        .insert(schema.worktrees)
        .values({
          workspaceId: input.workspaceId,
          kind: "agent",
          name: `import-${input.importId}-${randomUUID()}`,
          headSha: input.baseCommitSha,
          status: "active",
        })
        .returning({
          id: schema.worktrees.id,
          headSha: schema.worktrees.headSha,
        });
      if (!created) throw new Error("Unable to reserve an import worktree.");
      const currentPointer = previousWorktreeId
        ? eq(schema.agentSessionImports.worktreeId, previousWorktreeId)
        : isNull(schema.agentSessionImports.worktreeId);
      const linked = await transaction
        .update(schema.agentSessionImports)
        .set({ worktreeId: created.id, updatedAt: new Date() })
        .where(
          and(
            eq(schema.agentSessionImports.id, input.importId),
            eq(schema.agentSessionImports.workspaceId, input.workspaceId),
            currentPointer,
          ),
        )
        .returning({ id: schema.agentSessionImports.id });
      if (linked.length !== 1) {
        throw new Error(
          "Session import worktree reservation raced with another restore.",
        );
      }
      return created;
    });

    await createSandboxWorktree(
      input.workspaceId,
      worktree.id,
      input.baseCommitSha,
    );
    return { worktreeId: worktree.id };
  }

  async restoreRepositoryState(
    input: Parameters<SessionRepositoryRuntime["restoreRepositoryState"]>[0],
  ) {
    const result = await restoreSandboxSession({
      workspaceId: input.workspaceId,
      operationId: input.worktreeId,
      worktreeId: input.worktreeId,
      baseCommitSha: input.baseCommitSha,
      files: input.files,
    });
    return result.status === "restored"
      ? ({ restored: true } as const)
      : ({ restored: false, conflictPaths: result.conflictPaths } as const);
  }

  async discardWorktree(workspaceId: string, worktreeId: string) {
    try {
      await deleteSandboxWorktree(workspaceId, worktreeId);
    } finally {
      const now = new Date();
      await this.database
        .update(schema.worktrees)
        .set({ status: "discarded", discardedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.worktrees.id, worktreeId),
            eq(schema.worktrees.workspaceId, workspaceId),
          ),
        );
    }
  }
}

export function createSandboxSessionRepositoryRuntime() {
  return new SandboxSessionRepositoryRuntime();
}

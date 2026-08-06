import "server-only";

import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { publicationBranchNameSchema } from "@codev/contracts";
import { schema } from "@codev/db";

import { getDatabase } from "./database";
import { getRepository } from "./github";
import {
  PublicationError,
  publishAgentWorktreeBranch,
} from "./github-publication";
import {
  checkpointSandboxWorktree,
  executeInSandbox,
  rebaseSandboxWorktree,
} from "./orchestrator";
import { requireWorkspacePermission } from "./access";

export class AgentGitHubError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "AgentGitHubError";
  }
}

async function requireAgentWorktree(input: {
  workspaceId: string;
  worktreeId: string;
  userId: string;
}) {
  await requireWorkspacePermission(input.workspaceId, input.userId, "coSteer");

  const [row] = await getDatabase()
    .select({
      worktreeId: schema.worktrees.id,
      headSha: schema.worktrees.headSha,
      worktreeStatus: schema.worktrees.status,
      repository: schema.workspaces.repository,
      installationId: schema.workspaces.githubInstallationId,
      repositoryId: schema.workspaces.githubRepositoryId,
      baseSha: schema.workspaces.baseSha,
      defaultBranch: schema.workspaces.defaultBranch,
    })
    .from(schema.worktrees)
    .innerJoin(
      schema.workspaces,
      eq(schema.workspaces.id, schema.worktrees.workspaceId),
    )
    .where(
      and(
        eq(schema.worktrees.workspaceId, input.workspaceId),
        eq(schema.worktrees.id, input.worktreeId),
        eq(schema.worktrees.kind, "agent"),
      ),
    )
    .limit(1);

  if (!row) {
    throw new AgentGitHubError("Agent worktree not found.", 404);
  }
  if (row.worktreeStatus !== "active" && row.worktreeStatus !== "frozen") {
    throw new AgentGitHubError("This agent worktree is no longer active.");
  }
  if (
    !row.repository ||
    row.installationId === null ||
    row.repositoryId === null ||
    !row.baseSha
  ) {
    throw new AgentGitHubError(
      "Connect a GitHub repository before using GitHub tools.",
    );
  }

  const [integration] = await getDatabase()
    .select({ headSha: schema.worktrees.headSha })
    .from(schema.worktrees)
    .where(
      and(
        eq(schema.worktrees.workspaceId, input.workspaceId),
        eq(schema.worktrees.kind, "integration"),
      ),
    )
    .limit(1);
  if (!integration) {
    throw new AgentGitHubError("Integration worktree not found.", 404);
  }

  return { ...row, integrationHeadSha: integration.headSha };
}

async function readWorktreeHeadSha(
  workspaceId: string,
  worktreeId: string,
  fallback: string,
) {
  try {
    const result = await executeInSandbox(workspaceId, {
      worktreeId,
      command: ["git", "rev-parse", "HEAD"],
      timeoutSeconds: 15,
    });
    const sha = result.output.trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return sha;
  } catch {
    // Fall back to the durable worktree head.
  }
  return fallback;
}

/**
 * Sync the agent worktree onto the latest GitHub default-branch tip when the
 * workspace integration already has that tip; otherwise report that the
 * workspace must be stopped and synced first.
 */
export async function syncAgentWorktreeWithGitHub(input: {
  workspaceId: string;
  worktreeId: string;
  userId: string;
}) {
  const target = await requireAgentWorktree(input);
  const { repository, baseSha: githubTip } = await getRepository(
    input.userId,
    Number(target.installationId),
    Number(target.repositoryId),
  );

  const currentHead = await readWorktreeHeadSha(
    input.workspaceId,
    input.worktreeId,
    target.headSha,
  );
  const checkpoint = await checkpointSandboxWorktree(
    input.workspaceId,
    input.worktreeId,
    currentHead,
  );
  await getDatabase()
    .update(schema.worktrees)
    .set({ headSha: checkpoint.headSha, updatedAt: new Date() })
    .where(eq(schema.worktrees.id, input.worktreeId));

  if (target.integrationHeadSha !== githubTip) {
    return {
      synced: false as const,
      githubTip,
      defaultBranch: repository.default_branch,
      integrationHeadSha: target.integrationHeadSha,
      worktreeHeadSha: checkpoint.headSha,
      message:
        "The workspace integration branch is behind GitHub. Stop the sandbox, sync to the latest default branch, resume, then call github_sync again.",
    };
  }

  if (checkpoint.headSha === githubTip) {
    return {
      synced: true as const,
      githubTip,
      defaultBranch: repository.default_branch,
      worktreeHeadSha: checkpoint.headSha,
      message: "Agent worktree already matches the GitHub default-branch tip.",
    };
  }

  const rebased = await rebaseSandboxWorktree(
    input.workspaceId,
    input.worktreeId,
    {
      expectedHeadSha: checkpoint.headSha,
      ontoSha: target.integrationHeadSha,
    },
  );
  await getDatabase()
    .update(schema.worktrees)
    .set({ headSha: rebased.headSha, updatedAt: new Date() })
    .where(eq(schema.worktrees.id, input.worktreeId));

  return {
    synced: true as const,
    githubTip,
    defaultBranch: repository.default_branch,
    worktreeHeadSha: rebased.headSha,
    message: "Rebased the agent worktree onto the current integration tip.",
  };
}

/**
 * Publish the agent worktree tree to an immutable codev/* branch on GitHub.
 */
export async function publishAgentWorktreeToGitHub(input: {
  workspaceId: string;
  worktreeId: string;
  userId: string;
  branchName?: string;
}) {
  const target = await requireAgentWorktree(input);
  const branchName = publicationBranchNameSchema.parse(
    input.branchName?.trim() ||
      `codev/agent-${input.worktreeId.replace(/^wt-/, "").slice(0, 40)}`,
  );

  const currentHead = await readWorktreeHeadSha(
    input.workspaceId,
    input.worktreeId,
    target.headSha,
  );
  const checkpoint = await checkpointSandboxWorktree(
    input.workspaceId,
    input.worktreeId,
    currentHead,
  );
  await getDatabase()
    .update(schema.worktrees)
    .set({ headSha: checkpoint.headSha, updatedAt: new Date() })
    .where(eq(schema.worktrees.id, input.worktreeId));

  try {
    return await publishAgentWorktreeBranch({
      workspaceId: input.workspaceId,
      userId: input.userId,
      worktreeId: input.worktreeId,
      branchName,
      expectedHeadSha: checkpoint.headSha,
      requestId: randomUUID(),
      baseSha: target.baseSha!,
      repository: target.repository!,
      installationId: Number(target.installationId),
      repositoryId: Number(target.repositoryId),
    });
  } catch (error) {
    if (error instanceof PublicationError) {
      throw new AgentGitHubError(error.message, error.status);
    }
    throw error;
  }
}

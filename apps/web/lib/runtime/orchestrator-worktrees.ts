import "server-only";

import { z } from "zod";

import { orchestratorRequest } from "./orchestrator-request";

const worktreeReviewSchema = z.object({
  baseSha: z.string().regex(/^[0-9a-f]{40}$/),
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  diff: z.string(),
  diffDigest: z.string().regex(/^[0-9a-f]{64}$/),
});

export type SandboxWorktreeReview = z.infer<typeof worktreeReviewSchema>;

export async function createSandboxWorktree(
  workspaceId: string,
  worktreeId: string,
  headSha: string,
  branchName?: string,
) {
  await orchestratorRequest("POST", `/v1/sandboxes/${workspaceId}/worktrees`, {
    worktreeId,
    headSha,
    ...(branchName ? { branchName } : {}),
  });
}

export async function deleteSandboxWorktree(
  workspaceId: string,
  worktreeId: string,
) {
  await orchestratorRequest(
    "DELETE",
    `/v1/sandboxes/${workspaceId}/worktrees/${worktreeId}`,
  );
}

export async function checkpointSandboxWorktree(
  workspaceId: string,
  worktreeId: string,
  expectedHeadSha: string,
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/worktrees/${worktreeId}/checkpoint`,
    { expectedHeadSha },
  );
  return z
    .object({ headSha: z.string().regex(/^[0-9a-f]{40}$/) })
    .parse(await response.json());
}

export async function reviewSandboxWorktree(
  workspaceId: string,
  worktreeId: string,
  baseSha: string,
) {
  const response = await orchestratorRequest(
    "GET",
    `/v1/sandboxes/${workspaceId}/worktrees/${worktreeId}/review?baseSha=${encodeURIComponent(baseSha)}`,
  );
  return worktreeReviewSchema.parse(await response.json());
}

export async function rebaseSandboxWorktree(
  workspaceId: string,
  worktreeId: string,
  input: { expectedHeadSha: string; ontoSha: string },
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/worktrees/${worktreeId}/rebase`,
    input,
  );
  return z
    .object({ headSha: z.string().regex(/^[0-9a-f]{40}$/) })
    .parse(await response.json());
}

export async function mergeSandboxWorktree(
  workspaceId: string,
  worktreeId: string,
  input: {
    expectedIntegrationHeadSha: string;
    expectedWorktreeHeadSha: string;
    expectedDiffDigest: string;
  },
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/worktrees/${worktreeId}/merge`,
    input,
  );
  return z
    .object({ headSha: z.string().regex(/^[0-9a-f]{40}$/) })
    .parse(await response.json());
}

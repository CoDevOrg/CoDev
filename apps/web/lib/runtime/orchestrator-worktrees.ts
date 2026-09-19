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

const sessionRestoreResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("restored"),
    conflictPaths: z.array(z.string()).default([]),
  }),
  z.object({
    status: z.literal("conflicted"),
    conflictPaths: z.array(z.string()),
  }),
]);

export type SandboxSessionRestoreFile = {
  path: string;
  kind: "patch" | "untracked";
  contents: Uint8Array;
  sha256: string;
  mode: "100644" | "100755";
};

const SESSION_RESTORE_CHUNK_BYTES = 512 * 1_024;

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

export async function restoreSandboxSession(input: {
  workspaceId: string;
  operationId: string;
  worktreeId: string;
  baseCommitSha: string;
  files: SandboxSessionRestoreFile[];
}) {
  const path = `/v1/sandboxes/${input.workspaceId}/session-restores`;
  await orchestratorRequest("POST", path, {
    operationId: input.operationId,
    worktreeId: input.worktreeId,
    baseCommitSha: input.baseCommitSha,
    files: input.files.map(
      ({ path: filePath, kind, contents, sha256, mode }) => ({
        path: filePath,
        kind,
        bytes: contents.byteLength,
        sha256,
        mode,
      }),
    ),
  });

  for (const [fileIndex, file] of input.files.entries()) {
    for (
      let offset = 0;
      offset < file.contents.byteLength;
      offset += SESSION_RESTORE_CHUNK_BYTES
    ) {
      const chunk = file.contents.subarray(
        offset,
        Math.min(
          offset + SESSION_RESTORE_CHUNK_BYTES,
          file.contents.byteLength,
        ),
      );
      const response = await orchestratorRequest(
        "POST",
        `${path}/${input.operationId}/chunks`,
        {
          fileIndex,
          offset,
          contentBase64: Buffer.from(chunk).toString("base64"),
        },
      );
      const { nextOffset } = z
        .object({ nextOffset: z.number().int().nonnegative() })
        .parse(await response.json());
      if (nextOffset !== offset + chunk.byteLength) {
        throw new Error("Sandbox restore returned an invalid chunk offset.");
      }
    }
  }
  const response = await orchestratorRequest(
    "POST",
    `${path}/${input.operationId}/finalize`,
  );
  return sessionRestoreResultSchema.parse(await response.json());
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

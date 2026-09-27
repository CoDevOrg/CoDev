import "server-only";

import { z } from "zod";

import { orchestratorRequest } from "./orchestrator-request";

const terminalPollSchema = z.object({
  chunks: z.array(
    z.object({ sequence: z.number().int().nonnegative(), data: z.string() }),
  ),
  nextSequence: z.number().int().nonnegative(),
  exited: z.boolean(),
  exitCode: z.number().int().nullable(),
});

const worktreeSchema = z.object({
  worktreeId: z.string(),
  branch: z.string(),
});

async function requestSupersetRuntime(
  workspaceId: string,
  method: "GET" | "POST" | "DELETE",
  operation: string,
  body?: unknown,
) {
  return orchestratorRequest(
    method,
    `/v1/sandboxes/${workspaceId}/superset/runtime/${operation}`,
    body,
  );
}

export async function getSupersetGitOutput(
  workspaceId: string,
  worktreeId: string,
  operation: "status" | "diff",
) {
  const response = await requestSupersetRuntime(workspaceId, "POST", "git", {
    worktreeId,
    operation,
  });
  return z.object({ output: z.string() }).parse(await response.json()).output;
}

export async function listSupersetWorktrees(workspaceId: string) {
  const response = await requestSupersetRuntime(
    workspaceId,
    "GET",
    "worktrees",
  );
  return z
    .object({ worktrees: z.array(worktreeSchema) })
    .parse(await response.json()).worktrees;
}

export async function createSupersetWorktree(
  workspaceId: string,
  input: { worktreeId: string; branch: string; baseRef?: string | undefined },
) {
  const response = await requestSupersetRuntime(
    workspaceId,
    "POST",
    "worktrees",
    input,
  );
  return z.object({ worktree: worktreeSchema }).parse(await response.json())
    .worktree;
}

export async function startSupersetTerminal(
  workspaceId: string,
  input: { worktreeId: string; rows: number; columns: number },
) {
  const response = await requestSupersetRuntime(
    workspaceId,
    "POST",
    "terminal/start",
    input,
  );
  return z.object({ sessionId: z.string() }).parse(await response.json())
    .sessionId;
}

export async function sendSupersetTerminalInput(
  workspaceId: string,
  input: { worktreeId: string; sessionId: string; data: string },
) {
  await requestSupersetRuntime(workspaceId, "POST", "terminal/input", input);
}

export async function resizeSupersetTerminal(
  workspaceId: string,
  input: {
    worktreeId: string;
    sessionId: string;
    rows: number;
    columns: number;
  },
) {
  await requestSupersetRuntime(workspaceId, "POST", "terminal/resize", input);
}

export async function pollSupersetTerminal(
  workspaceId: string,
  input: { worktreeId: string; sessionId: string; after: number },
) {
  const response = await requestSupersetRuntime(
    workspaceId,
    "POST",
    "terminal/poll",
    input,
  );
  return terminalPollSchema.parse(await response.json());
}

export async function closeSupersetTerminal(
  workspaceId: string,
  input: { sessionId: string; worktreeId: string },
) {
  await requestSupersetRuntime(workspaceId, "DELETE", "terminal", input);
}

import "server-only";

import { gen2CoordinationReportSchema } from "@codev/contracts";
import { z } from "zod";

import { orchestratorRequest } from "./orchestrator-request";
import type { WorkspaceRuntimeTarget } from "./workspace-runtime-target";

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
  target?: WorkspaceRuntimeTarget,
) {
  return orchestratorRequest(
    method,
    `/v1/sandboxes/${workspaceId}/superset/runtime/${operation}`,
    body,
    undefined,
    target,
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
  target?: WorkspaceRuntimeTarget,
) {
  await requestSupersetRuntime(
    workspaceId,
    "POST",
    "terminal/input",
    input,
    target,
  );
}

export async function resizeSupersetTerminal(
  workspaceId: string,
  input: {
    worktreeId: string;
    sessionId: string;
    rows: number;
    columns: number;
  },
  target?: WorkspaceRuntimeTarget,
) {
  await requestSupersetRuntime(
    workspaceId,
    "POST",
    "terminal/resize",
    input,
    target,
  );
}

export async function pollSupersetTerminal(
  workspaceId: string,
  input: { worktreeId: string; sessionId: string; after: number },
  target?: WorkspaceRuntimeTarget,
) {
  const response = await requestSupersetRuntime(
    workspaceId,
    "POST",
    "terminal/poll",
    { ...input, waitMilliseconds: 20_000 },
    target,
  );
  return terminalPollSchema.parse(await response.json());
}

export async function closeSupersetTerminal(
  workspaceId: string,
  input: { sessionId: string; worktreeId: string },
) {
  await requestSupersetRuntime(workspaceId, "DELETE", "terminal", input);
}

export async function readSupersetCoordinationOverlaps(
  workspaceId: string,
  worktreeIds: string[],
) {
  const response = await requestSupersetRuntime(
    workspaceId,
    "POST",
    "coordination/overlaps",
    { worktreeIds },
  );
  return gen2CoordinationReportSchema.parse(await response.json());
}

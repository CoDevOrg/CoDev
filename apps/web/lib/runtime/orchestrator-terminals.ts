import "server-only";

import { z } from "zod";

import { orchestratorRequest } from "./orchestrator-request";

const terminalPollSchema = z.object({
  chunks: z.array(
    z.object({
      sequence: z.number().int().nonnegative(),
      data: z.string(),
    }),
  ),
  nextSequence: z.number().int().nonnegative(),
  exited: z.boolean(),
  exitCode: z.number().int().nullable(),
});

export async function startSandboxTerminal(
  workspaceId: string,
  input: { rows: number; columns: number },
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/terminals`,
    input,
  );
  return z.object({ sessionId: z.string() }).parse(await response.json())
    .sessionId;
}

export async function sendSandboxTerminalInput(
  workspaceId: string,
  sessionId: string,
  data: string,
) {
  await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/terminals/${sessionId}/input`,
    { data },
  );
}

export async function resizeSandboxTerminal(
  workspaceId: string,
  sessionId: string,
  input: { rows: number; columns: number },
) {
  await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/terminals/${sessionId}/resize`,
    input,
  );
}

export async function pollSandboxTerminal(
  workspaceId: string,
  sessionId: string,
  after: number,
) {
  const response = await orchestratorRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/terminals/${sessionId}/poll`,
    { after, waitMilliseconds: 20_000 },
  );
  return z.object({ result: terminalPollSchema }).parse(await response.json())
    .result;
}

export async function closeSandboxTerminal(
  workspaceId: string,
  sessionId: string,
) {
  await orchestratorRequest(
    "DELETE",
    `/v1/sandboxes/${workspaceId}/terminals/${sessionId}`,
  );
}

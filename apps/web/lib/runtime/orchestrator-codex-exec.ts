import "server-only";

import { z } from "zod";

import type { SandboxExecInput } from "./orchestrator-files";
import { codexExecRequest } from "./orchestrator-request";

const codexExecPollSchema = z.object({
  chunks: z.array(
    z.object({
      sequence: z.number().int().nonnegative(),
      dataBase64: z.string(),
    }),
  ),
  nextSequence: z.number().int().nonnegative(),
  exited: z.boolean(),
  exitCode: z.number().int().nullable(),
  codexAuthCacheJson: z.string().optional(),
});

/**
 * The original single-call Codex exec path: one HTTP request that blocks
 * for up to 910s while the whole turn runs. Superseded by
 * startCodexExecInSandbox/pollCodexExecInSandbox/closeCodexExecInSandbox
 * below, which stream a long-running turn as a series of short calls
 * instead. Left in place, unused by the default agent-runtime flow, as a
 * rollback path — see the "Async Codex exec + polling" plan's rollout
 * notes for why the guest side can't be swapped over uniformly in one step.
 */
export async function executeCodexInSandbox(
  workspaceId: string,
  input: SandboxExecInput & { codexAuthCacheJson: string },
) {
  const path = `/v1/sandboxes/${workspaceId}/pty/exec`;
  const body = { rows: 1_000, columns: 4_096, ...input };
  const response = await codexExecRequest("POST", path, body, 910_000);
  return z
    .object({
      result: z.object({
        output: z.string(),
        exitCode: z.number().int(),
        codexAuthCacheJson: z.string().optional(),
      }),
    })
    .parse(await response.json()).result;
}

export async function startCodexExecInSandbox(
  workspaceId: string,
  input: SandboxExecInput & {
    codexAuthCacheJson?: string;
    idempotencyKey: string;
  },
) {
  const body = { rows: 1_000, columns: 4_096, ...input };
  const response = await codexExecRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/codex-execs`,
    body,
    20_000,
  );
  return z.object({ sessionId: z.string() }).parse(await response.json())
    .sessionId;
}

export async function pollCodexExecInSandbox(
  workspaceId: string,
  sessionId: string,
  after: number,
) {
  const response = await codexExecRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/codex-execs/${sessionId}/poll`,
    { after, waitMilliseconds: 25_000 },
    35_000,
  );
  return z.object({ result: codexExecPollSchema }).parse(await response.json())
    .result;
}

export async function closeCodexExecInSandbox(
  workspaceId: string,
  sessionId: string,
) {
  await codexExecRequest(
    "DELETE",
    `/v1/sandboxes/${workspaceId}/codex-execs/${sessionId}`,
    undefined,
    20_000,
  );
}

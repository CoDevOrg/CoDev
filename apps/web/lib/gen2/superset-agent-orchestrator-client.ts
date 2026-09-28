import "server-only";

import { z } from "zod";

import { codexExecRequest } from "../runtime/orchestrator-request";

/**
 * Thin HTTP client for the Superset agent-launch routes
 * docs/SUPERSET_AGENT_SESSION_PLAN.md Phase 3 adds to the orchestrator
 * (which forwards to `codev-guestd`, which calls Superset's host-service
 * private bridge). Named to match the existing `/v1/sandboxes/{id}/
 * codex-execs` convention in `orchestrator-codex-exec.ts`.
 *
 * PROVISIONAL: `services/orchestrator/src/http_api.rs` does not implement
 * these routes yet -- only the apps/web side of Phase 3 has landed so far.
 * Every call here will fail (404, or whatever `fakeGuestEnabled()` does
 * with an unmodelled path) until that Rust work exists. The request/
 * response shapes below are this adapter's best-effort match to the plan
 * text and the existing Codex-exec routes' conventions, not a confirmed
 * wire contract -- expect to revise them once the Rust routes are real.
 */

const supersetAgentStartResponseSchema = z.object({
  hostWorkspaceId: z.string(),
  hostTerminalId: z.string(),
  hostAgentSessionId: z.string(),
});

const supersetAgentPollResponseSchema = z.object({
  chunks: z.array(
    z.object({
      sequence: z.number().int().nonnegative(),
      dataBase64: z.string(),
    }),
  ),
  nextSequence: z.number().int().nonnegative(),
  exited: z.boolean(),
  exitCode: z.number().int().nullable(),
  /** Set once the launched process has exited and a refresh capture is safe. */
  refreshReady: z.boolean(),
});

const supersetAgentRecoveryResponseSchema = z.object({
  adoptable: z.boolean(),
});

export type SupersetAgentStartInput = {
  worktreeId: string;
  provider: string;
  codexAuthCacheJson?: string;
  command: string[];
  idempotencyKey: string;
};

export async function startSupersetAgent(
  workspaceId: string,
  input: SupersetAgentStartInput,
) {
  const response = await codexExecRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/superset-agents`,
    input,
    20_000,
  );
  return supersetAgentStartResponseSchema.parse(await response.json());
}

export async function sendSupersetAgentInput(
  workspaceId: string,
  agentId: string,
  data: string,
) {
  await codexExecRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/superset-agents/${agentId}/input`,
    { data },
    20_000,
  );
}

export async function pollSupersetAgent(
  workspaceId: string,
  agentId: string,
  after: number,
) {
  const response = await codexExecRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/superset-agents/${agentId}/poll`,
    { after, waitMilliseconds: 25_000 },
    35_000,
  );
  return supersetAgentPollResponseSchema.parse(await response.json());
}

export async function stopSupersetAgent(workspaceId: string, agentId: string) {
  await codexExecRequest(
    "DELETE",
    `/v1/sandboxes/${workspaceId}/superset-agents/${agentId}`,
    undefined,
    20_000,
  );
}

export async function checkSupersetAgentRecovery(
  workspaceId: string,
  agentId: string,
) {
  const response = await codexExecRequest(
    "GET",
    `/v1/sandboxes/${workspaceId}/superset-agents/${agentId}/recovery`,
    undefined,
    20_000,
  );
  return supersetAgentRecoveryResponseSchema.parse(await response.json());
}

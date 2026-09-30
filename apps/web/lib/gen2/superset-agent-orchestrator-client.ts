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
 * The orchestrator (`services/orchestrator/src/guest.rs`) and
 * `vendor/superset/.../codev/agents.ts` routes this calls now exist
 * (Phase 3), but neither has run against a real bun toolchain or a live
 * Firecracker guest -- treat the wire shapes below as unverified until a
 * real end-to-end run exercises them.
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
      // Plain text, not base64: matches the terminal-snapshot convention
      // `orchestrator-superset-runtime.ts`'s `terminalPollSchema` already
      // uses for this same host-service poll shape, and what
      // `vendor/superset/.../codev/agents.ts` actually returns. Each chunk is
      // a full buffer snapshot (prefixed with a clear-screen escape), not an
      // incremental append -- see `recordGen2SupersetRunOutput` in turns.ts.
      data: z.string(),
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

export type SupersetAgentPollChunk = z.infer<
  typeof supersetAgentPollResponseSchema
>["chunks"][number];

export type SupersetAgentStartInput = {
  worktreeId: string;
  provider: string;
  /** Superseded by `launchProfile`; both are sent while guest images that
   *  predate the profile may still be running. */
  launchProfile?: {
    files?: Array<{ path: string; contents: string }>;
    env?: Record<string, string>;
  };
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

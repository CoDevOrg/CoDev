import "server-only";

import { z } from "zod";

import {
  codexExecRequest,
  OrchestratorError,
} from "../runtime/orchestrator-request";

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
    z
      .object({
        sequence: z.number().int().nonnegative(),
        // Plain text, not base64: matches the terminal-snapshot convention
        // `orchestrator-superset-runtime.ts`'s `terminalPollSchema` already
        // uses for this same host-service poll shape, and what
        // `vendor/superset/.../codev/agents.ts` actually returns. Each chunk is
        // a full buffer snapshot (prefixed with a clear-screen escape), not an
        // incremental append -- see `recordGen2SupersetRunOutput` in turns.ts.
        data: z.string().optional(),
        dataBase64: z.string().optional(),
      })
      .refine(
        (chunk) => chunk.data !== undefined || chunk.dataBase64 !== undefined,
      )
      .transform((chunk) => ({
        sequence: chunk.sequence,
        data:
          chunk.data ??
          Buffer.from(chunk.dataBase64!, "base64").toString("utf8"),
      })),
  ),
  nextSequence: z.number().int().nonnegative(),
  exited: z.boolean(),
  exitCode: z.number().int().nullable(),
  /** Set once the launched process has exited and a refresh capture is safe. */
  refreshReady: z.boolean(),
});

const supersetAgentRecoveryResponseSchema = z.object({
  adoptable: z.boolean(),
  status: z.enum(["running", "exited", "not_found", "failed"]).optional(),
  exitCode: z.number().int().nullable().optional(),
  sequence: z.number().int().nonnegative().optional(),
  bufferLength: z.number().int().nonnegative().optional(),
  worktreeId: z.string().optional(),
});

export type SupersetAgentPollChunk = z.infer<
  typeof supersetAgentPollResponseSchema
>["chunks"][number];

export type SupersetAgentStartInput = {
  codevRunId: string;
  codevWorkspaceId: string;
  worktreeId: string;
  provider: string;
  /** The client also derives the legacy Codex field from this profile while
   * older guest images still require it. */
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
  // Older host-service images require codexAuthCacheJson and cannot read
  // launchProfile. Derive it only from the initiating member's Codex file;
  // retain the neutral profile for current images and other providers.
  const legacyAuth =
    input.provider === "openai"
      ? input.launchProfile?.files?.find(
          (file) => file.path === ".codex/auth.json",
        )?.contents
      : undefined;
  let response: Response;
  try {
    response = await codexExecRequest(
      "POST",
      `/v1/sandboxes/${workspaceId}/superset-agents`,
      { ...input, ...(legacyAuth ? { codexAuthCacheJson: legacyAuth } : {}) },
      20_000,
    );
  } catch (error) {
    if (
      error instanceof OrchestratorError &&
      error.status === 400 &&
      error.message === "Invalid Superset agent start request."
    ) {
      throw new OrchestratorError(
        "This workspace's agent runtime needs an update before it can start this agent. Your message was kept; please contact support.",
        503,
      );
    }
    throw error;
  }
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
  const payload = (await response.json()) as { result?: unknown } | null;
  const parsed = supersetAgentPollResponseSchema.safeParse(
    payload?.result ?? payload,
  );
  if (!parsed.success)
    throw new OrchestratorError(
      "The workspace runtime returned an unsupported agent response. Your chat is saved; please contact support.",
      503,
    );
  return parsed.data;
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
  const payload = (await response.json()) as { result?: unknown } | null;
  const parsed = supersetAgentRecoveryResponseSchema.safeParse(
    payload?.result ?? payload,
  );
  if (!parsed.success)
    throw new OrchestratorError(
      "The workspace runtime returned an unsupported recovery response. Please contact support.",
      503,
    );
  return parsed.data;
}

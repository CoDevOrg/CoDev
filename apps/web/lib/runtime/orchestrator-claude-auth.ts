import "server-only";

import { z } from "zod";

import { claudeSetupRequest } from "./orchestrator-request";

const claudeSetupPollSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("ready") }).strict(),
  z.object({ status: z.literal("failed"), reason: z.string() }),
]);

export async function startClaudeSetupTokenInSandbox(
  workspaceId: string,
  input: { idempotencyKey: string },
) {
  const response = await claudeSetupRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/claude-auth-login`,
    input,
    35_000,
  );
  return z
    .object({
      sessionId: z.string(),
      authorizeUrl: z.string().url(),
      claudeVersion: z.string().optional(),
    })
    .parse(await response.json());
}

export async function submitClaudeSetupTokenCodeInSandbox(
  workspaceId: string,
  sessionId: string,
  code: string,
) {
  await claudeSetupRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/claude-auth-login/${sessionId}/code`,
    { code },
    20_000,
  );
}

export async function pollClaudeSetupTokenInSandbox(
  workspaceId: string,
  sessionId: string,
) {
  const response = await claudeSetupRequest(
    "POST",
    `/v1/sandboxes/${workspaceId}/claude-auth-login/${sessionId}/poll`,
    { waitMilliseconds: 25_000 },
    35_000,
  );
  return z
    .object({ result: claudeSetupPollSchema })
    .parse(await response.json()).result;
}

export async function closeClaudeSetupTokenInSandbox(
  workspaceId: string,
  sessionId: string,
) {
  await claudeSetupRequest(
    "DELETE",
    `/v1/sandboxes/${workspaceId}/claude-auth-login/${sessionId}`,
    undefined,
    20_000,
  );
}

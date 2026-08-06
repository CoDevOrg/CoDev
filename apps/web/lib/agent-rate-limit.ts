import "server-only";

import { consumeRateLimit } from "./rate-limit";
import {
  getAgentKeySource as getCredentialAgentKeySource,
  getOpenAICredentialStatus,
} from "./credentials";
import type { AuthProvider } from "@codev/shared-types";
import { byokSpamLimiter, retryAfterSeconds } from "./upstash-rate-limit";

export class AgentPromptRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Agent prompt limit reached. Wait briefly and try again.");
    this.name = "AgentPromptRateLimitError";
  }
}

export type AgentKeySource = "byok";

/**
 * All agent prompts require USER or WORKSPACE credentials (BYOK). Anti-spam
 * limits still apply so a single key cannot flood the control plane.
 */
export async function getAgentKeySource(
  userId: string,
  workspaceId?: string,
  provider: AuthProvider = "openai",
): Promise<AgentKeySource> {
  if (workspaceId) {
    return getCredentialAgentKeySource(userId, workspaceId, provider);
  }
  if (await getOpenAICredentialStatus(userId)) return "byok";
  throw new Error(
    "Connect a Codex, Claude, or Cursor credential in Settings before starting an agent.",
  );
}

export async function enforceAgentPromptRateLimit(
  userId: string,
  workspaceId?: string,
  provider: AuthProvider = "openai",
) {
  const source = await getAgentKeySource(userId, workspaceId, provider);
  if (byokSpamLimiter) {
    const result = await byokSpamLimiter.limit(`${source}:${userId}`);
    if (!result.success) {
      throw new AgentPromptRateLimitError(retryAfterSeconds(result.reset));
    }
  } else {
    const fallback = await consumeRateLimit(
      userId,
      "byok-agent-prompt",
      100,
      60,
    );
    if (!fallback.allowed) {
      throw new AgentPromptRateLimitError(fallback.retryAfterSeconds);
    }
  }

  return source;
}

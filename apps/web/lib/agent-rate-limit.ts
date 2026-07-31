import "server-only";

import { consumeRateLimit } from "./rate-limit";
import {
  getAgentKeySource as getCredentialAgentKeySource,
  getOpenAICredentialStatus,
} from "./credentials";
import type { AuthProvider } from "@codev/shared-types";
import {
  aiAgentLimiter,
  byokSpamLimiter,
  retryAfterSeconds,
} from "./upstash-rate-limit";

export class AgentPromptRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Agent prompt limit reached. Upgrade or add your own API key.");
    this.name = "AgentPromptRateLimitError";
  }
}

export type AgentKeySource = "byok" | "platform";

/**
 * User and workspace-scoped (organization) credentials are BYOK. Either must
 * bypass the platform allowance while retaining the separate anti-spam limit.
 */
export async function getAgentKeySource(
  userId: string,
  workspaceId?: string,
  provider: AuthProvider = "openai",
): Promise<AgentKeySource> {
  if (workspaceId) {
    return getCredentialAgentKeySource(userId, workspaceId, provider);
  }
  return (await getOpenAICredentialStatus(userId)) ? "byok" : "platform";
}

export async function enforceAgentPromptRateLimit(
  userId: string,
  workspaceId?: string,
  provider: AuthProvider = "openai",
) {
  const source = await getAgentKeySource(userId, workspaceId, provider);
  const limiter = source === "byok" ? byokSpamLimiter : aiAgentLimiter;
  if (limiter) {
    const result = await limiter.limit(`${source}:${userId}`);
    if (!result.success) {
      throw new AgentPromptRateLimitError(retryAfterSeconds(result.reset));
    }
  } else {
    const fallback =
      source === "byok"
        ? await consumeRateLimit(userId, "byok-agent-prompt", 100, 60)
        : await consumeRateLimit(userId, "platform-agent-prompt", 30, 60 * 60);
    if (!fallback.allowed) {
      throw new AgentPromptRateLimitError(fallback.retryAfterSeconds);
    }
  }

  return source;
}

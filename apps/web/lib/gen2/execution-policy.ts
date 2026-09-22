import type { Gen2AgentExecutionPolicy } from "@codev/contracts";

/** The compatibility default preserves existing Gen 2 agent behavior. */
export const DEFAULT_GEN2_AGENT_EXECUTION_POLICY: Gen2AgentExecutionPolicy = {
  allowFileChanges: true,
};

/**
 * Converts the persisted row into the only policy shape the runtime accepts.
 * Keeping this separate from membership capabilities prevents clients from
 * supplying an execution policy with a turn request.
 */
export function resolveGen2AgentExecutionPolicy(input: {
  allowFileChanges: boolean | null | undefined;
}): Gen2AgentExecutionPolicy {
  return {
    allowFileChanges:
      input.allowFileChanges ??
      DEFAULT_GEN2_AGENT_EXECUTION_POLICY.allowFileChanges,
  };
}

/** The Codex CLI enforces this filesystem boundary for the complete turn. */
export function gen2CodexSandboxForPolicy(policy: Gen2AgentExecutionPolicy) {
  return policy.allowFileChanges ? "danger-full-access" : "read-only";
}

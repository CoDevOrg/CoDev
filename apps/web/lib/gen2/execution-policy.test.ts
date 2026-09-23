import { describe, expect, it } from "vitest";

import {
  DEFAULT_GEN2_AGENT_EXECUTION_POLICY,
  gen2CodexSandboxForPolicy,
  resolveGen2AgentExecutionPolicy,
} from "./execution-policy";

describe("Gen 2 agent execution policy", () => {
  it("defaults old and partial workspace rows to file changes enabled", () => {
    expect(DEFAULT_GEN2_AGENT_EXECUTION_POLICY).toEqual({
      allowFileChanges: true,
    });
    expect(resolveGen2AgentExecutionPolicy({})).toEqual(
      DEFAULT_GEN2_AGENT_EXECUTION_POLICY,
    );
  });

  it("maps a no-file-changes policy to Codex's read-only sandbox", () => {
    expect(gen2CodexSandboxForPolicy({ allowFileChanges: false })).toBe(
      "read-only",
    );
    expect(gen2CodexSandboxForPolicy({ allowFileChanges: true })).toBe(
      "danger-full-access",
    );
  });
});

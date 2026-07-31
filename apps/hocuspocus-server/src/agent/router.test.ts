import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_MODEL, parseAgentStreamInput } from "./router";

describe("Hocuspocus agent input", () => {
  it("uses the configured supported default model", () => {
    const input = parseAgentStreamInput({
      workspaceId: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
      sessionId: null,
      turnId: null,
      actor: {
        userId: "2f2387ed-4a63-4b05-88cc-266d65f7b82b",
        userName: "Ada",
        avatarUrl: null,
      },
      prompt: "Inspect the workspace.",
      apiKey: "test-key",
    });

    expect(input.model).toBe(DEFAULT_AGENT_MODEL);
    expect(input.model).not.toBe("gpt-5.6-sol");
  });
});

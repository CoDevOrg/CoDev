import { describe, expect, it } from "vitest";

import { agentEventSchema, createAgentEvent } from "./agent-event";

const workspaceId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const sessionId = "8f4dd3e4-63a9-4b64-a9e7-97e0c25c77c5";
const turnId = "f3b771ef-d90c-49e3-b7f4-72a0ea40ce7d";
const actorId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";

describe("AgentEvent", () => {
  it("creates a normalized user prompt event", () => {
    const event = createAgentEvent({
      workspaceId,
      sessionId,
      turnId,
      actor: { userId: actorId, userName: "Yousef", avatarUrl: null },
      modelProvider: "openai",
      modelName: "gpt-5",
      type: "USER_PROMPT",
      payload: { promptText: "Inspect the workspace." },
    });

    expect(agentEventSchema.parse(event)).toEqual(event);
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects events outside the shared contract", () => {
    expect(() =>
      agentEventSchema.parse({
        workspaceId,
        actor: { userId: actorId, userName: "Yousef", avatarUrl: null },
        modelProvider: "openai",
        modelName: "gpt-5",
        type: "UNKNOWN",
        payload: {},
        timestamp: Date.now(),
      }),
    ).toThrow();
  });

  it("accepts reviewer comments as durable workspace events", () => {
    const event = createAgentEvent({
      workspaceId,
      sessionId,
      turnId: null,
      actor: { userId: actorId, userName: "Reviewer", avatarUrl: null },
      modelProvider: "custom",
      modelName: "human-review",
      type: "COMMENT_ADDED",
      payload: {
        commentText: "Please add a regression test.",
        filePath: "src/auth.ts",
        metadata: { lineNumber: 42 },
      },
    });

    expect(agentEventSchema.parse(event).payload.commentText).toBe(
      "Please add a regression test.",
    );
  });
});

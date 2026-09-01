import { describe, expect, it } from "vitest";

import {
  callCoordinationTool,
  COORDINATION_TOOLS,
  type CoordinationToolContext,
} from "./coordination-mcp-tools";

const CTX: CoordinationToolContext = {
  workspaceId: "w",
  sessionId: "s",
  userId: "u",
};

describe("COORDINATION_TOOLS", () => {
  it("every tool has a name, a description, and an object input schema", () => {
    expect(COORDINATION_TOOLS.length).toBeGreaterThan(0);
    for (const tool of COORDINATION_TOOLS) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("exposes the core-loop tools", () => {
    const names = COORDINATION_TOOLS.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "situational_awareness",
        "declare_intent",
        "claim_path",
        "contest_path",
        "release_claim",
        "list_claims",
        "search_brain",
        "record_finding",
        "list_coordination",
      ]),
    );
  });

  it("exposes peer negotiation and team chat", () => {
    const names = COORDINATION_TOOLS.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "request_claim_coordination",
        "respond_to_claim",
        "resolve_coordination",
        "read_team_chat",
        "post_team_chat",
      ]),
    );
  });

  /**
   * The brain's overlap warning tells an agent to "use
   * request_claim_coordination, post_team_chat". Every tool it names has to
   * exist here, or a CLI agent that hits an overlap is sent after something it
   * cannot call — the bug this toolset shipped with.
   */
  it("has every tool the workspace brain's overlap warning points agents at", () => {
    const names = new Set(COORDINATION_TOOLS.map((tool) => tool.name));
    for (const named of ["request_claim_coordination", "post_team_chat"]) {
      expect(names.has(named)).toBe(true);
    }
  });
});

describe("callCoordinationTool — input guards (no DB)", () => {
  it("fails an unknown tool", async () => {
    const result = await callCoordinationTool(CTX, "teleport", {});
    expect(result).toEqual({ text: "Unknown tool: teleport", isError: true });
  });

  it("fails declare_intent with nothing to update", async () => {
    const result = await callCoordinationTool(CTX, "declare_intent", {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain("at least one of");
  });

  it("fails release_claim without a claimId", async () => {
    const result = await callCoordinationTool(CTX, "release_claim", {});
    expect(result).toEqual({
      text: "release_claim requires a claimId.",
      isError: true,
    });
  });

  it("fails search_brain without a query", async () => {
    const result = await callCoordinationTool(CTX, "search_brain", {
      limit: 5,
    });
    expect(result).toEqual({
      text: "search_brain requires a query.",
      isError: true,
    });
  });

  it("fails request_claim_coordination when a field is missing", async () => {
    const result = await callCoordinationTool(
      CTX,
      "request_claim_coordination",
      { toSessionId: "other", claimId: "c", path: "a.ts" },
    );
    expect(result.isError).toBe(true);
    // The failure has to say where the session id comes from, or the model
    // cannot recover from it.
    expect(result.text).toContain("situational_awareness");
  });

  it("fails respond_to_claim on a decision it does not know", async () => {
    const result = await callCoordinationTool(CTX, "respond_to_claim", {
      toSessionId: "other",
      responseToId: "m",
      correlationId: "c",
      claimId: "cl",
      decision: "maybe",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("accept, reject or counter");
  });

  it("refuses a reject or counter with no reason for the other agent to act on", async () => {
    for (const decision of ["reject", "counter"]) {
      const result = await callCoordinationTool(CTX, "respond_to_claim", {
        toSessionId: "other",
        responseToId: "m",
        correlationId: "c",
        claimId: "cl",
        decision,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("needs a reason");
    }
  });

  it("fails resolve_coordination on an unknown status", async () => {
    const result = await callCoordinationTool(CTX, "resolve_coordination", {
      messageId: "m",
      status: "done",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("delivered or resolved");
  });

  it("fails post_team_chat without a channel or a body", async () => {
    expect(
      (await callCoordinationTool(CTX, "post_team_chat", { body: "hi" })).text,
    ).toBe("post_team_chat requires a channel name.");
    expect(
      (
        await callCoordinationTool(CTX, "post_team_chat", {
          channel: "#general",
        })
      ).text,
    ).toBe("post_team_chat requires a message body.");
  });
});

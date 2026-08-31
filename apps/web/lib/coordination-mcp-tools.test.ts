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
    const result = await callCoordinationTool(CTX, "search_brain", { limit: 5 });
    expect(result).toEqual({
      text: "search_brain requires a query.",
      isError: true,
    });
  });
});

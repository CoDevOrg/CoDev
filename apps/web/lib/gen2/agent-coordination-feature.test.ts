import { afterEach, describe, expect, it, vi } from "vitest";

import { isGen2AgentCoordinationEnabled } from "./agent-coordination-feature";

describe("isGen2AgentCoordinationEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless the workspace is listed", () => {
    vi.stubEnv("CODEV_AGENT_COORDINATION_WORKSPACES", "");
    expect(isGen2AgentCoordinationEnabled("a")).toBe(false);

    vi.stubEnv("CODEV_AGENT_COORDINATION_WORKSPACES", " a , b ");
    expect(isGen2AgentCoordinationEnabled("a")).toBe(true);
    expect(isGen2AgentCoordinationEnabled("c")).toBe(false);
  });

  it("enables every workspace with *", () => {
    vi.stubEnv("CODEV_AGENT_COORDINATION_WORKSPACES", "*");
    expect(isGen2AgentCoordinationEnabled("any")).toBe(true);
  });
});

import { afterEach, describe, expect, it } from "vitest";

import { isGen2SupersetAgentSessionsEnabled } from "./superset-agent-sessions-feature";

describe("isGen2SupersetAgentSessionsEnabled", () => {
  afterEach(() => {
    delete process.env.CODEV_SUPERSET_AGENT_SESSIONS_ENABLED;
  });

  it("defaults to off", () => {
    expect(isGen2SupersetAgentSessionsEnabled()).toBe(false);
  });

  it("is off for anything other than the literal string true", () => {
    process.env.CODEV_SUPERSET_AGENT_SESSIONS_ENABLED = "1";
    expect(isGen2SupersetAgentSessionsEnabled()).toBe(false);
  });

  it("is on when explicitly enabled", () => {
    process.env.CODEV_SUPERSET_AGENT_SESSIONS_ENABLED = "true";
    expect(isGen2SupersetAgentSessionsEnabled()).toBe(true);
  });
});

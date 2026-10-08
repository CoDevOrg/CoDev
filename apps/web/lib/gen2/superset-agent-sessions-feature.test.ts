import { afterEach, describe, expect, it } from "vitest";

import {
  isGen2SupersetAgentSessionsEnabled,
  isGen2SupersetCursorAgentsEnabled,
  isGen2SupersetTurn,
} from "./superset-agent-sessions-feature";

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

describe("Superset Cursor agents and turn routing", () => {
  afterEach(() => {
    delete process.env.CODEV_SUPERSET_AGENT_SESSIONS_ENABLED;
    delete process.env.CODEV_SUPERSET_CURSOR_AGENTS_ENABLED;
  });

  it("enables Cursor only on top of Superset agent sessions", () => {
    process.env.CODEV_SUPERSET_CURSOR_AGENTS_ENABLED = "true";
    expect(isGen2SupersetCursorAgentsEnabled()).toBe(false);
    process.env.CODEV_SUPERSET_AGENT_SESSIONS_ENABLED = "true";
    expect(isGen2SupersetCursorAgentsEnabled()).toBe(true);
  });

  it("routes Superset run IDs to Superset and guest session IDs natively", () => {
    const runId = "77777777-7777-4777-8777-777777777777";
    expect(isGen2SupersetTurn(runId)).toBe(false);
    process.env.CODEV_SUPERSET_AGENT_SESSIONS_ENABLED = "true";
    expect(isGen2SupersetTurn(runId)).toBe(true);
    expect(isGen2SupersetTurn("codex-1728400000000-3")).toBe(false);
  });
});

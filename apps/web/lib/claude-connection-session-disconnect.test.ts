import { beforeEach, describe, expect, it, vi } from "vitest";

import { encodeClaudeRuntimeReference } from "./claude-runtime-reference";

vi.mock("server-only", () => ({}));
vi.mock("./observability", () => ({ logEvent: vi.fn() }));

const runnerId = encodeClaudeRuntimeReference({
  version: 1,
  backend: "orchestrator",
  profileId: "11111111-1111-4111-8111-111111111111",
  sessionId: "claude-1-1",
});

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(),
  isClaudeRunnerDisposableHere: vi.fn(() => true),
}));

vi.mock("./claude-connection-runner", () => ({
  resolveClaudeRunner: () => ({ dispose: mocks.dispose }),
  isClaudeRunnerDisposableHere: mocks.isClaudeRunnerDisposableHere,
}));

/** One "connected" claude_connection_sessions row, updated in place by the
 *  module's `.update(...).set(...).where(...)` call so the test can assert on
 *  its final status the same way a real disconnect would leave it. */
let rows: Array<Record<string, unknown>>;

vi.mock("./database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: async () => rows.filter((row) => row.status === "connected"),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          // The real query scopes by id; this fake applies to every row a
          // test leaves in `rows`, which each test keeps to exactly one.
          rows = rows.map((row) => ({ ...row, ...patch }));
        },
      }),
    }),
  }),
}));

import { disconnectClaudeRuntime } from "./claude-connection-session";

beforeEach(() => {
  rows = [{ id: "session-1", userId: "u1", status: "connected", runnerId }];
  mocks.dispose.mockReset().mockResolvedValue(undefined);
  mocks.isClaudeRunnerDisposableHere.mockReturnValue(true);
});

describe("disconnectClaudeRuntime", () => {
  it("marks the session disconnected after a successful remote dispose", async () => {
    await disconnectClaudeRuntime("u1");
    expect(mocks.dispose).toHaveBeenCalledWith({ runnerId });
    expect(rows[0]).toMatchObject({ status: "failed" });
  });

  /**
   * The bug this guards: the orchestrator being unreachable (no local
   * orchestrator running, a network blip, an already-torn-down sandbox that
   * doesn't 404 cleanly) used to abort the whole disconnect before the local
   * row was ever updated — "Disconnect" looked like it did nothing, and
   * retrying hit the exact same unreachable orchestrator every time.
   */
  it("still marks the session disconnected when the remote dispose fails", async () => {
    mocks.dispose.mockRejectedValue(new Error("orchestrator unreachable"));
    await disconnectClaudeRuntime("u1");
    expect(mocks.dispose).toHaveBeenCalledWith({ runnerId });
    expect(rows[0]).toMatchObject({ status: "failed" });
  });

  it("skips the remote dispose but still disconnects a profile unreachable from here", async () => {
    mocks.isClaudeRunnerDisposableHere.mockReturnValue(false);
    await disconnectClaudeRuntime("u1");
    expect(mocks.dispose).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: "failed" });
  });
});

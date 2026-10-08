import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  runs: vi.fn(),
  report: vi.fn(),
  enabled: vi.fn(),
}));

vi.mock("./workspaces", () => ({
  requireGen2Member: (...args: unknown[]) => mocks.member(...args),
}));
vi.mock("./superset-runs", () => ({
  listGen2SupersetRuns: (...args: unknown[]) => mocks.runs(...args),
}));
vi.mock("../runtime/orchestrator-superset-runtime", () => ({
  readSupersetCoordinationOverlaps: (...args: unknown[]) =>
    mocks.report(...args),
}));
vi.mock("./agent-coordination-feature", () => ({
  isGen2AgentCoordinationEnabled: (...args: unknown[]) =>
    mocks.enabled(...args),
}));

import { listGen2AgentOverlaps } from "./agent-overlaps";

const RUN_ONE = "11111111-1111-4111-8111-111111111111";
const RUN_TWO = "22222222-2222-4222-8222-222222222222";
const MEMBER_ONE = "33333333-3333-4333-8333-333333333333";
const MEMBER_TWO = "44444444-4444-4444-8444-444444444444";

function run(id: string, worktreeId: string, status = "running") {
  return {
    id,
    worktreeId,
    status,
    provider: id === RUN_ONE ? "codex" : "claude",
    createdBy: id === RUN_ONE ? MEMBER_ONE : MEMBER_TWO,
  };
}

describe("listGen2AgentOverlaps", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.member.mockResolvedValue({ role: "viewer", status: "ready" });
    mocks.enabled.mockReturnValue(true);
  });

  it("maps a worktree overlap to both active sessions for any member", async () => {
    mocks.runs.mockResolvedValue([
      run(RUN_ONE, "fix-auth"),
      run(RUN_TWO, "rate-limit"),
      run("55555555-5555-4555-8555-555555555555", "old", "finished"),
    ]);
    mocks.report.mockResolvedValue({
      worktrees: [
        { worktreeId: "fix-auth", state: "known" },
        { worktreeId: "rate-limit", state: "large" },
      ],
      overlaps: [
        {
          worktreeIds: ["fix-auth", "rate-limit"],
          path: "src/auth.ts",
          level: "function",
          symbols: ["login"],
        },
      ],
      truncated: false,
    });

    const result = await listGen2AgentOverlaps("workspace-1", "viewer-1");

    expect(mocks.report).toHaveBeenCalledWith("workspace-1", [
      "fix-auth",
      "rate-limit",
    ]);
    expect(result).toEqual({
      overlaps: [
        {
          runId: RUN_ONE,
          otherRunId: RUN_TWO,
          otherWorktreeId: "rate-limit",
          otherProvider: "claude",
          otherCreatedBy: MEMBER_TWO,
          path: "src/auth.ts",
          level: "function",
          symbols: ["login"],
        },
        {
          runId: RUN_TWO,
          otherRunId: RUN_ONE,
          otherWorktreeId: "fix-auth",
          otherProvider: "codex",
          otherCreatedBy: MEMBER_ONE,
          path: "src/auth.ts",
          level: "function",
          symbols: ["login"],
        },
      ],
      unavailableWorktreeIds: ["rate-limit"],
    });
  });

  it.each([
    ["coordination is off", false, "ready", 2],
    ["the workspace is not ready", true, "stopped", 2],
    ["fewer than two worktrees are active", true, "ready", 1],
  ])(
    "does not contact the guest when %s",
    async (_, enabled, status, count) => {
      mocks.enabled.mockReturnValue(enabled);
      mocks.member.mockResolvedValue({ role: "owner", status });
      mocks.runs.mockResolvedValue(
        [run(RUN_ONE, "fix-auth"), run(RUN_TWO, "rate-limit")].slice(0, count),
      );

      expect(await listGen2AgentOverlaps("workspace-1", "user-1")).toEqual({
        overlaps: [],
        unavailableWorktreeIds: [],
      });
      expect(mocks.report).not.toHaveBeenCalled();
    },
  );

  it("requires current membership", async () => {
    mocks.member.mockRejectedValue(new Error("Workspace not found."));

    await expect(
      listGen2AgentOverlaps("workspace-1", "former"),
    ).rejects.toThrow("Workspace not found.");
    expect(mocks.runs).not.toHaveBeenCalled();
  });
});

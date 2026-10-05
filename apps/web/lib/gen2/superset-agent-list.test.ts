import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ member: vi.fn(), list: vi.fn() }));
vi.mock("./workspaces", () => ({
  requireGen2Member: (...args: unknown[]) => mocks.member(...args),
}));
vi.mock("./superset-runs", () => ({
  listGen2SupersetRuns: (...args: unknown[]) => mocks.list(...args),
}));

import { listGen2SupersetAgentRuns } from "./superset-agent-list";

describe("Superset agent metadata list", () => {
  beforeEach(() => vi.resetAllMocks());

  it("lists recovered sessions and excludes private run fields", async () => {
    mocks.member.mockResolvedValue({ role: "viewer" });
    mocks.list.mockResolvedValue([
      {
        id: "run-1",
        chatId: null,
        createdBy: "member-1",
        worktreeId: "agent-1",
        provider: "codex",
        status: "recovery_required",
        recoveryCount: 2,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        connectionId: "private-credential",
        hostTerminalId: "private-terminal",
        lastError: "secret-bearing provider error",
      },
    ]);
    const runs = await listGen2SupersetAgentRuns("workspace-1", "viewer-1");
    expect(mocks.member).toHaveBeenCalledWith("workspace-1", "viewer-1");
    expect(runs).toEqual([
      {
        id: "run-1",
        chatId: null,
        createdBy: "member-1",
        worktreeId: "agent-1",
        provider: "codex",
        status: "recovery_required",
        recoveryCount: 2,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ]);
  });

  it("does not query runs after membership removal", async () => {
    mocks.member.mockRejectedValue(new Error("Workspace not found."));
    await expect(
      listGen2SupersetAgentRuns("workspace-1", "former-member"),
    ).rejects.toThrow("Workspace not found.");
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

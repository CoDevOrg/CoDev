import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ member: vi.fn(), list: vi.fn() }));
vi.mock("./workspaces", () => ({
  requireGen2Member: (...args: unknown[]) => mocks.member(...args),
}));
vi.mock("./superset-runs", () => ({
  listActiveGen2SupersetRuns: (...args: unknown[]) => mocks.list(...args),
}));

import { listGen2SupersetAgentRuns } from "./superset-agent-list";

describe("Superset agent metadata list", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rechecks membership and excludes private run fields", async () => {
    mocks.member.mockResolvedValue({ role: "viewer" });
    mocks.list.mockResolvedValue([
      {
        id: "run-1",
        chatId: null,
        createdBy: "member-1",
        worktreeId: "agent-1",
        provider: "codex",
        status: "running",
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
        status: "running",
        createdAt: new Date(0),
        updatedAt: new Date(0),
        canInput: false,
        canCancel: false,
        canRecover: false,
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

  it("returns controls only when the server policy permits them", async () => {
    mocks.member.mockResolvedValue({ role: "owner" });
    mocks.list.mockResolvedValue([
      {
        id: "run-1",
        chatId: null,
        createdBy: "creator-1",
        worktreeId: "agent-1",
        provider: "codex",
        status: "running",
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ]);

    await expect(
      listGen2SupersetAgentRuns("workspace-1", "owner-1"),
    ).resolves.toMatchObject([
      { canInput: false, canCancel: true, canRecover: false },
    ]);
  });
});

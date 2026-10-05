import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ member: vi.fn(), list: vi.fn() }));

vi.mock("./workspaces", () => ({
  requireGen2Member: (...args: unknown[]) => mocks.member(...args),
}));
vi.mock("./agent-sessions", () => ({
  listGen2AgentSessions: (...args: unknown[]) => mocks.list(...args),
}));

import { listGen2AgentSessionMetadata } from "./agent-session-list";

describe("logical agent-session metadata", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requires membership and returns safe session metadata", async () => {
    mocks.member.mockResolvedValue({ role: "viewer" });
    mocks.list.mockResolvedValue([
      {
        id: "session-1",
        chatId: null,
        createdBy: "member-1",
        task: "Update the readme",
        worktreeId: "agent-1",
        provider: "openai",
        status: "recovery_required",
        recoveryState: "required",
        safeOutput: [{ kind: "message", text: "Waiting to recover." }],
        finalChanges: [],
        createdAt: new Date(0),
        updatedAt: new Date(0),
        credentialId: "private",
        hostTerminalId: "private",
      },
    ]);

    await expect(
      listGen2AgentSessionMetadata("workspace-1", "viewer-1"),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "session-1",
        task: "Update the readme",
        recoveryState: "required",
      }),
    ]);
    expect(mocks.member).toHaveBeenCalledWith("workspace-1", "viewer-1");
  });
});

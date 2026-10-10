import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  poll: vi.fn(),
  turn: null as Record<string, unknown> | null,
}));
vi.mock("./workspaces", () => ({ requireGen2Member: mocks.member }));
vi.mock("./agent", () => ({ pollGen2AgentTurn: mocks.poll }));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (mocks.turn ? [mocks.turn] : []) }),
      }),
    }),
  }),
}));

import { driveGen2AgentTurn } from "./agent-turn-drive";

const input = { workspaceId: "w", userId: "member", sessionId: "s1" };

describe("driveGen2AgentTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.member.mockResolvedValue({ role: "editor" });
    mocks.turn = {
      userId: "owner",
      nextSequence: 7,
      exited: false,
      updatedAt: new Date(Date.now() - 60_000),
    };
  });

  it("polls a quiet turn as the member who started it", async () => {
    await expect(driveGen2AgentTurn(input)).resolves.toBe(true);
    expect(mocks.poll).toHaveBeenCalledWith({
      workspaceId: "w",
      userId: "owner",
      sessionId: "s1",
      after: 7,
    });
  });

  it("refuses viewers", async () => {
    mocks.member.mockResolvedValue({ role: "viewer" });
    await expect(driveGen2AgentTurn(input)).rejects.toMatchObject({
      status: 403,
    });
    expect(mocks.poll).not.toHaveBeenCalled();
  });

  it("leaves a turn whose own tab is still polling alone", async () => {
    mocks.turn = { ...mocks.turn, updatedAt: new Date() };
    await expect(driveGen2AgentTurn(input)).resolves.toBe(false);
    expect(mocks.poll).not.toHaveBeenCalled();
  });
});

import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  poll: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  log: vi.fn(),
}));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ orderBy: () => ({ limit: mocks.select }) }),
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: mocks.update }) }),
  }),
}));
vi.mock("../platform/observability", () => ({ logEvent: mocks.log }));
vi.mock("./agent", () => ({ pollGen2AgentTurn: mocks.poll }));
import { reconcileArmWorkspaceTurns } from "./arm-workspace-turns-reconcile";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockResolvedValue([
    {
      workspaceId: "workspace-a",
      sessionId: "session-a",
      userId: "member-a",
      nextSequence: 4,
    },
  ]);
  mocks.poll.mockResolvedValue({ exited: true });
});
it("persists an abandoned turn using its member identity and durable cursor", async () => {
  await reconcileArmWorkspaceTurns();
  expect(mocks.poll).toHaveBeenCalledWith({
    workspaceId: "workspace-a",
    sessionId: "session-a",
    userId: "member-a",
    nextSequence: 4,
    after: 4,
  });
  expect(mocks.update).toHaveBeenCalled();
});
it("leaves failed drains pending for recovery", async () => {
  mocks.poll.mockRejectedValue(new Error("not authorized"));
  await reconcileArmWorkspaceTurns();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.log).toHaveBeenCalledWith("warn", "gen2.arm.turn_drain_failed", {
    workspaceId: "workspace-a",
    sessionId: "session-a",
  });
});

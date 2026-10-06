vi.mock("../billing/workspace-entitlement", () => ({
  getWorkspaceOwnerEntitlement: vi.fn(async () => ({
    tier: "paid",
    enabled: true,
    unlimited: false,
    ownedWorkspaceCount: 1,
    monthlyLimitMs: 60_000_000,
  })),
}));
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sessions = [
    {
      id: "session-a",
      workspaceId: "workspace-a",
      ownerId: "owner",
      startedAt: new Date("2026-10-01T10:00:00Z"),
      lastActivityAt: new Date("2026-10-01T11:00:00Z"),
    },
    {
      id: "session-b",
      workspaceId: "workspace-b",
      ownerId: "owner",
      startedAt: new Date("2026-10-01T10:00:00Z"),
      lastActivityAt: new Date("2026-10-01T11:00:00Z"),
    },
  ];
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  const missing = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  const active = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  const activeOwner = { from: vi.fn(), where: vi.fn() };
  const update = { set: vi.fn(), where: vi.fn() };
  return {
    running: vi.fn(),
    agentRunning: vi.fn(),
    pendingTurns: vi.fn(),
    sessions,
    missing,
    query,
    active,
    activeOwner,
    update,
    select: vi.fn(),
    updateTable: vi.fn(() => update),
    getHostState: vi.fn(),
    getSandbox: vi.fn(),
    ownerHasUnlimitedCompute: vi.fn(async () => false),
    usedComputeMs: vi.fn(),
    stop: vi.fn(),
    end: vi.fn(),
  };
});

vi.mock("./arm-workspace-turns-reconcile", () => ({
  reconcileArmWorkspaceTurns: vi.fn(async () => undefined),
}));
vi.mock("./arm-workspace-pending-turns", () => ({
  hasPendingArmWorkspaceTurns: mocks.pendingTurns,
}));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({ select: mocks.select, update: mocks.updateTable }),
}));
vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));
vi.mock("../runtime/fake-guest", () => ({ fakeGuestEnabled: () => false }));
vi.mock("../runtime/host", () => ({ getHostState: mocks.getHostState }));
vi.mock("../runtime/orchestrator-sandbox", () => ({
  getSandbox: mocks.getSandbox,
}));
vi.mock("../runtime/arm-workspace-provider", () => ({
  ArmWorkspaceProvider: class {
    async powerState(...args: unknown[]) {
      return (await mocks.running(...args))
        ? "PowerState/running"
        : "PowerState/deallocated";
    }
  },
}));
vi.mock("../runtime/arm-workspace-activity", () => ({
  armWorkspaceAgentRunning: mocks.agentRunning,
}));
vi.mock("./instance", () => ({ stopGen2Instance: mocks.stop }));
vi.mock("./compute-quota", () => ({
  MONTHLY_COMPUTE_LIMIT_MS: 60_000_000,
  endComputeSession: mocks.end,
  ownerHasUnlimitedCompute: mocks.ownerHasUnlimitedCompute,
  startComputeSession: vi.fn(),
  usedComputeMs: mocks.usedComputeMs,
}));

import { reconcileComputeQuota } from "./compute-reconcile";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pendingTurns.mockResolvedValue(false);
  mocks.ownerHasUnlimitedCompute.mockResolvedValue(false);
  mocks.select
    .mockReturnValueOnce(mocks.missing)
    .mockReturnValueOnce(mocks.active)
    .mockReturnValue(mocks.activeOwner);
  mocks.missing.from.mockReturnValue(mocks.missing);
  mocks.missing.leftJoin.mockReturnValue(mocks.missing);
  mocks.missing.where.mockReturnValue(mocks.missing);
  mocks.missing.orderBy.mockReturnValue(mocks.missing);
  mocks.missing.limit.mockResolvedValue([]);
  mocks.query.from.mockReturnValue(mocks.query);
  mocks.query.where.mockReturnValue(mocks.query);
  mocks.query.orderBy.mockReturnValue(mocks.query);
  mocks.query.limit.mockResolvedValue(mocks.sessions);
  mocks.active.from.mockReturnValue(mocks.active);
  mocks.active.innerJoin.mockReturnValue(mocks.active);
  mocks.active.where.mockReturnValue(mocks.active);
  mocks.active.orderBy.mockReturnValue(mocks.active);
  mocks.active.limit.mockResolvedValue(mocks.sessions);
  mocks.activeOwner.from.mockReturnValue(mocks.activeOwner);
  mocks.activeOwner.where.mockResolvedValue(
    mocks.sessions.map(({ workspaceId }) => ({ workspaceId })),
  );
  mocks.getHostState.mockResolvedValue("running");
  mocks.getSandbox.mockResolvedValue({
    lastActivityAt: "2026-10-01T11:59:00Z",
  });
  mocks.update.set.mockReturnValue(mocks.update);
  mocks.update.where.mockResolvedValue(undefined);
  mocks.usedComputeMs.mockResolvedValue(60_000_000);
  mocks.stop.mockResolvedValue(undefined);
});

it("stops all active workspaces sharing an owner's exhausted monthly pool", async () => {
  const result = await reconcileComputeQuota(new Date("2026-10-01T12:00:00Z"));
  expect(result).toEqual({ checked: 2, stopped: 2 });
  expect(mocks.stop.mock.calls).toEqual([
    ["workspace-a", "owner"],
    ["workspace-b", "owner"],
  ]);
});

it("does not stop an application admin's workspaces at the monthly limit", async () => {
  mocks.ownerHasUnlimitedCompute.mockResolvedValue(true);

  const result = await reconcileComputeQuota(new Date("2026-10-01T12:00:00Z"));

  expect(result).toEqual({ checked: 2, stopped: 0 });
  expect(mocks.stop).not.toHaveBeenCalled();
});

it("ends active billing when the host is stopped without waking a guest", async () => {
  mocks.getHostState.mockResolvedValue("stopped");
  mocks.select
    .mockReset()
    .mockReturnValueOnce(mocks.missing)
    .mockReturnValueOnce(mocks.active)
    .mockReturnValue(mocks.activeOwner);
  mocks.usedComputeMs.mockResolvedValue(0);
  await reconcileComputeQuota(new Date("2026-10-01T12:00:00Z"));
  expect(mocks.getSandbox).not.toHaveBeenCalled();
  expect(mocks.end).toHaveBeenCalledTimes(2);
});

it("keeps a running ARM agent alive after its members close their tabs", async () => {
  mocks.active.limit.mockResolvedValueOnce([
    {
      ...mocks.sessions[0],
      runtimeProvider: "azure_arm",
      runtimeStatus: "ready",
      runtimeGeneration: 2,
      runtimeVmResourceId: "vm",
    },
  ]);
  mocks.running.mockResolvedValue(true);
  mocks.agentRunning.mockResolvedValue(true);
  mocks.usedComputeMs.mockResolvedValue(0);
  await reconcileComputeQuota(new Date("2026-10-01T12:00:00Z"));
  expect(mocks.agentRunning).toHaveBeenCalledWith("workspace-a");
  expect(mocks.stop).not.toHaveBeenCalled();
  expect(mocks.update.set).toHaveBeenCalledWith({
    lastActivityAt: new Date("2026-10-01T12:00:00Z"),
  });
});

it("does not interpret an unreachable ARM activity bridge as an idle guest", async () => {
  mocks.active.limit.mockResolvedValueOnce([
    {
      ...mocks.sessions[0],
      runtimeProvider: "azure_arm",
      runtimeStatus: "ready",
      runtimeGeneration: 2,
      runtimeVmResourceId: "vm",
    },
  ]);
  mocks.running.mockResolvedValue(true);
  mocks.agentRunning.mockRejectedValue(new Error("unreachable"));
  mocks.usedComputeMs.mockResolvedValue(0);
  await reconcileComputeQuota(new Date("2026-10-01T12:00:00Z"));
  expect(mocks.stop).not.toHaveBeenCalled();
});

it("stops an idle ARM guest only after confirming no agent is running", async () => {
  mocks.active.limit.mockResolvedValueOnce([
    {
      ...mocks.sessions[0],
      runtimeProvider: "azure_arm",
      runtimeStatus: "ready",
      runtimeGeneration: 2,
      runtimeVmResourceId: "vm",
    },
  ]);
  mocks.running.mockResolvedValue(true);
  mocks.agentRunning.mockResolvedValue(false);
  mocks.usedComputeMs.mockResolvedValue(0);
  await reconcileComputeQuota(new Date("2026-10-01T12:00:00Z"));
  expect(mocks.stop).toHaveBeenCalledWith("workspace-a", "owner");
});

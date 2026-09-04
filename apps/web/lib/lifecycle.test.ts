import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectQuery = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  const updateQuery = {
    set: vi.fn(),
    where: vi.fn(),
  };
  const deleteQuery = {
    where: vi.fn(),
  };
  const database = {
    select: vi.fn(() => selectQuery),
    update: vi.fn(() => updateQuery),
    delete: vi.fn(() => deleteQuery),
  };
  const getHostState = vi.fn().mockResolvedValue("running");

  selectQuery.from.mockReturnValue(selectQuery);
  selectQuery.where.mockReturnValue(selectQuery);
  selectQuery.limit.mockResolvedValue([]);
  updateQuery.set.mockReturnValue(updateQuery);
  updateQuery.where.mockResolvedValue(undefined);
  deleteQuery.where.mockResolvedValue(undefined);

  return { database, getHostState, selectQuery };
});

vi.mock("workflow/api", () => ({ getRun: vi.fn() }));
vi.mock("./database", () => ({ getDatabase: () => mocks.database }));
vi.mock("./host", () => ({
  getHostState: mocks.getHostState,
}));
vi.mock("./audit", () => ({ appendWorkspaceEvent: vi.fn() }));
vi.mock("./observability", () => ({ logEvent: vi.fn() }));
vi.mock("./orchestrator", () => ({
  destroySandbox: vi.fn().mockResolvedValue(undefined),
  stopIde: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./vm-usage", () => ({
  closeOrphanSandboxIntervals: vi.fn().mockResolvedValue(0),
}));
vi.mock("./compute-credits", () => ({
  closeOrphanOrcaIntervals: vi.fn().mockResolvedValue(0),
}));
vi.mock("./workspaces", () => ({ markWorkspaceStopped: vi.fn() }));
vi.mock("./hibernation", () => ({ hibernateWorkspace: vi.fn() }));

import { destroySandboxForCleanup, reconcileLifecycle } from "./lifecycle";

describe("reconcileLifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHostState.mockResolvedValue("running");
    mocks.selectQuery.limit.mockResolvedValue([]);
  });

  it("finds no hibernation candidates when none are idle past their deadline", async () => {
    const result = await reconcileLifecycle();

    expect(result.hibernated).toBe(0);
    expect(result.hibernationFailures).toBe(0);
    expect(mocks.database.select).toHaveBeenCalledTimes(2);
  });

  it("hibernates idle ready workspaces when the host is running", async () => {
    const { hibernateWorkspace } = await import("./hibernation");
    vi.mocked(hibernateWorkspace).mockResolvedValueOnce(true);
    mocks.selectQuery.limit
      .mockResolvedValueOnce([]) // expired workspaces
      .mockResolvedValueOnce([{ id: "workspace-2" }]); // hibernation candidates

    const result = await reconcileLifecycle();

    expect(hibernateWorkspace).toHaveBeenCalledWith("workspace-2");
    expect(result.hibernated).toBe(1);
    expect(result.hibernationFailures).toBe(0);
  });

  it("counts a hibernation failure without aborting the rest of the batch", async () => {
    const { hibernateWorkspace } = await import("./hibernation");
    vi.mocked(hibernateWorkspace).mockRejectedValueOnce(
      new Error("snapshot failed"),
    );
    mocks.selectQuery.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "workspace-3" }]);

    const result = await reconcileLifecycle();

    expect(result.hibernated).toBe(0);
    expect(result.hibernationFailures).toBe(1);
  });

  it("does not attempt hibernation when the Firecracker host is unavailable", async () => {
    mocks.getHostState.mockResolvedValue("stopped");
    const { hibernateWorkspace } = await import("./hibernation");

    const result = await reconcileLifecycle();

    expect(hibernateWorkspace).not.toHaveBeenCalled();
    expect(result.hibernated).toBe(0);
    expect(mocks.database.select).toHaveBeenCalledTimes(1);
  });

  it("continues housekeeping when the Firecracker host is unavailable", async () => {
    mocks.getHostState.mockRejectedValue(
      new Error("Firecracker host unavailable"),
    );

    await expect(reconcileLifecycle()).resolves.toMatchObject({
      hostState: "unavailable",
      hibernated: 0,
    });
  });

  it("does not fail lifecycle cleanup when the orchestrator is unavailable", async () => {
    const { destroySandbox } = await import("./orchestrator");
    vi.mocked(destroySandbox).mockRejectedValueOnce(
      new Error("Firecracker host unavailable"),
    );

    await expect(destroySandboxForCleanup("workspace-1")).resolves.toBe(false);
  });

  it("also stops this workspace's Orca IDE session on cleanup", async () => {
    const { destroySandbox, stopIde } = await import("./orchestrator");
    vi.mocked(destroySandbox).mockResolvedValueOnce(undefined);

    await expect(destroySandboxForCleanup("workspace-1")).resolves.toBe(true);
    expect(stopIde).toHaveBeenCalledWith("workspace-1");
  });

  it("does not fail lifecycle cleanup when stopping the Orca IDE session fails", async () => {
    const { destroySandbox, stopIde } = await import("./orchestrator");
    vi.mocked(destroySandbox).mockResolvedValueOnce(undefined);
    vi.mocked(stopIde).mockRejectedValueOnce(
      new Error("orchestrator unavailable"),
    );

    await expect(destroySandboxForCleanup("workspace-1")).resolves.toBe(true);
  });
});

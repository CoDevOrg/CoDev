import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  beginWorkspaceProvisioning: vi.fn(),
  clearWorkspaceSnapshot: vi.fn(),
  getHostState: vi.fn(),
  getWorkspaceForMember: vi.fn(),
  getWorkspaceSnapshot: vi.fn(),
  getWorkspaceRuntime: vi.fn(),
  markWorkspaceReady: vi.fn(),
  provisionSandbox: vi.fn(),
  recordWorkspaceHeartbeat: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  waitForOrchestrator: vi.fn(),
}));

vi.mock("./hibernation", () => ({
  E2B_LIFECYCLE_OPTIONS: {},
  clearWorkspaceSnapshot: mocks.clearWorkspaceSnapshot,
  getWorkspaceSnapshot: mocks.getWorkspaceSnapshot,
}));
vi.mock("./github", () => ({ getRepositorySnapshot: vi.fn() }));
vi.mock("./host", () => ({
  getHostState: mocks.getHostState,
  requestHostWake: vi.fn(),
}));
vi.mock("./heartbeat", () => ({
  recordWorkspaceHeartbeat: mocks.recordWorkspaceHeartbeat,
}));
vi.mock("./access", () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
}));
vi.mock("./orchestrator", () => ({
  provisionSandbox: mocks.provisionSandbox,
  waitForOrchestrator: mocks.waitForOrchestrator,
}));
vi.mock("./workspaces", () => ({
  beginWorkspaceProvisioning: mocks.beginWorkspaceProvisioning,
  getWorkspaceForMember: mocks.getWorkspaceForMember,
  getWorkspaceRuntime: mocks.getWorkspaceRuntime,
  markWorkspaceFailed: vi.fn(),
  markWorkspaceReady: mocks.markWorkspaceReady,
  WorkspaceLifecycleError: class WorkspaceLifecycleError extends Error {},
}));

import { ensureWorkspaceRuntimeReady } from "./runtime-resume";

describe("workspace runtime resume", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getWorkspaceRuntime.mockResolvedValue({ status: "ready" });
  });

  it("allows reviewers to wake a runtime for diff review", async () => {
    await ensureWorkspaceRuntimeReady("workspace-1", "user-1", "review");

    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      "workspace-1",
      "user-1",
      "review",
    );
    expect(mocks.recordWorkspaceHeartbeat).toHaveBeenCalledWith("workspace-1");
  });

  it("keeps the default resume capability restricted to co-steerers", async () => {
    await ensureWorkspaceRuntimeReady("workspace-1", "user-1");

    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      "workspace-1",
      "user-1",
      "coSteer",
    );
  });

  it("passes reviewer permission through snapshot provisioning", async () => {
    mocks.getWorkspaceRuntime.mockResolvedValue({ status: "hibernated" });
    mocks.getWorkspaceForMember.mockResolvedValue({
      repository: "acme/demo",
      repositoryVisibility: "public",
      baseSha: "base-sha",
    });
    mocks.beginWorkspaceProvisioning.mockResolvedValue(
      new Date("2026-07-31T00:00:00.000Z"),
    );
    mocks.getHostState.mockResolvedValue("running");
    mocks.getWorkspaceSnapshot.mockResolvedValue({
      snapshot: { files: [] },
    });
    mocks.provisionSandbox.mockResolvedValue({
      id: "sandbox-1",
      headSha: "head-sha",
    });

    await ensureWorkspaceRuntimeReady("workspace-1", "user-1", "review");

    expect(mocks.beginWorkspaceProvisioning).toHaveBeenCalledWith(
      "workspace-1",
      "user-1",
      "review",
    );
    expect(mocks.provisionSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        resumeFromSnapshot: true,
      }),
    );
    expect(mocks.markWorkspaceReady).toHaveBeenCalledWith(
      "workspace-1",
      "sandbox-1",
      "head-sha",
    );
  });
});

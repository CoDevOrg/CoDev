import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class OrchestratorError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly conflictPaths: string[] = [],
    ) {
      super(message);
      this.name = "OrchestratorError";
    }
  }
  return {
    OrchestratorError,
    getHostState: vi.fn(),
    requestHostWake: vi.fn(),
    waitForOrchestrator: vi.fn().mockResolvedValue(undefined),
    startIde: vi.fn(),
    stopIde: vi.fn().mockResolvedValue(undefined),
    assertWorkspaceCreditQuota: vi.fn().mockResolvedValue(undefined),
    openOrcaInterval: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./host", () => ({
  getHostState: mocks.getHostState,
  requestHostWake: mocks.requestHostWake,
}));
vi.mock("./github", () => ({ getGitHubUserToken: vi.fn() }));
vi.mock("./orchestrator", () => ({
  OrchestratorError: mocks.OrchestratorError,
  startIde: mocks.startIde,
  stopIde: mocks.stopIde,
  waitForOrchestrator: mocks.waitForOrchestrator,
}));
vi.mock("./quotas", () => ({
  QuotaError: class QuotaError extends Error {},
  assertWorkspaceCreditQuota: mocks.assertWorkspaceCreditQuota,
}));
vi.mock("./compute-credits", () => ({
  openOrcaInterval: mocks.openOrcaInterval,
}));

import { ensureOrcaSession, OrcaHostError } from "./orca-host";

const workspaceId = "c1f9fe13-6881-44a6-adbd-96bc5a946afa";
const userId = "5a946afa-6881-44a6-adbd-c1f9fe136881";
const workspace = {
  id: workspaceId,
  repository: null,
  repositoryVisibility: null,
  defaultBranch: null,
};
const readyPayload = {
  type: "orca_server_ready",
  schemaVersion: 1,
  runtimeId: "runtime-1",
  boundEndpoint: null,
  advertisedEndpoint: null,
  pairing: {
    available: true,
    url: "orca://pair?code=abc123",
    endpoint: `https://runtime.example/w/${workspaceId}/pair`,
    deviceId: "device-1",
    webClientUrl: null,
    scope: "runtime" as const,
  },
};
const session = {
  workspaceId,
  port: 5173,
  createdAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  ready: readyPayload,
};

describe("ensureOrcaSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHostState.mockResolvedValue("running");
    mocks.waitForOrchestrator.mockResolvedValue(undefined);
    mocks.stopIde.mockResolvedValue(undefined);
  });

  it("stops the stale IDE record and retries once after a crashed launch", async () => {
    mocks.startIde
      .mockRejectedValueOnce(
        new mocks.OrchestratorError(
          "Orca IDE process exited before reporting readiness",
          500,
        ),
      )
      .mockResolvedValueOnce(session);

    await expect(ensureOrcaSession(workspace, userId)).resolves.toMatchObject({
      state: "ready",
    });
    expect(mocks.stopIde).toHaveBeenCalledWith(workspaceId);
    expect(mocks.startIde).toHaveBeenCalledTimes(2);
  });

  it("does not retry orchestrator errors unrelated to a crashed launch", async () => {
    mocks.startIde.mockRejectedValueOnce(
      new mocks.OrchestratorError("Sandbox service returned HTTP 503.", 503),
    );

    await expect(ensureOrcaSession(workspace, userId)).rejects.toMatchObject({
      message: "Sandbox service returned HTTP 503.",
    });
    expect(mocks.stopIde).not.toHaveBeenCalled();
    expect(mocks.startIde).toHaveBeenCalledTimes(1);
  });

  it("surfaces the crash as an OrcaHostError when the retry also fails", async () => {
    const staleError = new mocks.OrchestratorError(
      "Orca IDE process exited before reporting readiness",
      500,
    );
    mocks.startIde
      .mockRejectedValueOnce(staleError)
      .mockRejectedValueOnce(staleError);

    const result = ensureOrcaSession(workspace, userId);
    await expect(result).rejects.toBeInstanceOf(OrcaHostError);
    await expect(result).rejects.toMatchObject({
      message: "Orca IDE process exited before reporting readiness",
      status: 500,
    });
    expect(mocks.stopIde).toHaveBeenCalledTimes(1);
    expect(mocks.startIde).toHaveBeenCalledTimes(2);
  });
});

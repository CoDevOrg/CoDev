import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
  claimResults: [] as Array<Array<{ id: string }>>,
  onClaimFailure: vi.fn(),
  create: vi.fn(),
  getStatus: vi.fn(),
  healthy: vi.fn(),
  running: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    GEN2_ARM_WORKSPACE_LIFECYCLE: {
      create: mocks.create,
      get: vi.fn(async () => ({ status: mocks.getStatus })),
    },
  },
}));

vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [mocks.row] }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.updates.push(values);
        return {
          where: () => ({
            returning: async () => {
              const result = mocks.claimResults.shift() ?? [
                { id: String(mocks.row.id) },
              ];
              if (result.length) Object.assign(mocks.row, values);
              else mocks.onClaimFailure();
              return result;
            },
          }),
        };
      },
    }),
  }),
}));

vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));

vi.mock("../runtime/arm-workspace-provider", () => ({
  ArmWorkspaceProvider: class {
    healthy(...args: unknown[]) {
      return mocks.healthy(...args);
    }
    running(...args: unknown[]) {
      return mocks.running(...args);
    }
  },
  ArmWorkspaceRuntimeError: class ArmWorkspaceRuntimeError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));

import {
  queueAzureWorkspaceStart,
  touchAzureWorkspaceActivity,
} from "./runtime-operations";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";

function workspaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: workspaceId,
    ownerId: "owner-1",
    status: "stopped",
    runtimeProvider: "azure_arm",
    runtimeStatus: "stopped",
    runtimeGeneration: 0,
    runtimeVmResourceId: null,
    runtimeDiskResourceId: null,
    runtimeDiskUuid: null,
    runtimeTunnelId: null,
    runtimeRouteHost: null,
    runtimeCleanupGeneration: null,
    runtimeOperationId: null,
    runtimeOperationKey: null,
    runtimeOperationKind: null,
    runtimeOperationStartedAt: null,
    runtimeLeaseExpiresAt: null,
    ...overrides,
  };
}

describe("Azure workspace operation claims", () => {
  beforeEach(() => {
    mocks.row = workspaceRow();
    mocks.updates = [];
    mocks.claimResults = [];
    mocks.onClaimFailure.mockReset();
    mocks.create.mockReset().mockResolvedValue(undefined);
    mocks.getStatus.mockReset().mockResolvedValue({ status: "running" });
    mocks.healthy.mockReset().mockResolvedValue(false);
    mocks.running.mockReset().mockResolvedValue(false);
  });

  it("persists a new resource generation before dispatching its workflow", async () => {
    const result = await queueAzureWorkspaceStart(workspaceId, "start-key");

    expect(result).toMatchObject({ accepted: true, generation: 1 });
    expect(mocks.updates[0]).toMatchObject({
      runtimeGeneration: 1,
      runtimeCleanupGeneration: null,
      runtimeOperationKind: "start",
      runtimeOperationKey: "start-key",
      runtimeStatus: "queued",
    });
    expect(mocks.create).toHaveBeenCalledWith({
      id: result.operationId,
      params: {
        workspaceId,
        operationId: result.operationId,
        generation: 1,
        resourceGeneration: 1,
        cleanupGeneration: null,
        kind: "start",
      },
    });
  });

  it("records the previous generation that must be cleaned before replacement", async () => {
    mocks.row = workspaceRow({
      status: "ready",
      runtimeStatus: "ready",
      runtimeGeneration: 4,
      runtimeVmResourceId: "/subscriptions/s/resourceGroups/r/vms/old",
      runtimeDiskResourceId: "/subscriptions/s/resourceGroups/r/disks/data",
      runtimeDiskUuid: "saved-uuid",
    });

    const result = await queueAzureWorkspaceStart(workspaceId, "replace-key");

    expect(result).toMatchObject({ accepted: true, generation: 5 });
    expect(mocks.updates[0]).toMatchObject({
      runtimeGeneration: 5,
      runtimeCleanupGeneration: 4,
    });
    expect(mocks.create).toHaveBeenCalledWith({
      id: result.operationId,
      params: expect.objectContaining({
        resourceGeneration: 5,
        cleanupGeneration: 4,
      }),
    });
  });

  it("keeps a running VM when only its tunnel health check fails", async () => {
    mocks.row = workspaceRow({
      status: "ready",
      runtimeStatus: "ready",
      runtimeGeneration: 4,
      runtimeVmResourceId: "/subscriptions/s/resourceGroups/r/vms/current",
    });
    mocks.running.mockResolvedValue(true);

    expect(await queueAzureWorkspaceStart(workspaceId, "retry-key")).toEqual({
      accepted: false,
      operationId: null,
    });
    expect(mocks.running).toHaveBeenCalledWith(
      workspaceId,
      4,
      mocks.row.runtimeVmResourceId,
    );
    expect(mocks.updates).toEqual([]);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not replace a VM when Azure power state is unavailable", async () => {
    mocks.row = workspaceRow({
      status: "ready",
      runtimeStatus: "ready",
      runtimeVmResourceId: "/subscriptions/s/resourceGroups/r/vms/current",
    });
    mocks.running.mockRejectedValue(new Error("Azure unavailable"));

    await expect(
      queueAzureWorkspaceStart(workspaceId, "retry-key"),
    ).rejects.toThrow("Azure unavailable");
    expect(mocks.updates).toEqual([]);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("joins the operation that won the database compare-and-set race", async () => {
    const existingOperationId = "8a149e5a-d974-48d9-a0b3-cb2fa5c537d1";
    mocks.claimResults = [[]];
    mocks.onClaimFailure.mockImplementation(() => {
      Object.assign(
        mocks.row,
        workspaceRow({
          status: "provisioning",
          runtimeStatus: "queued",
          runtimeGeneration: 1,
          runtimeOperationId: existingOperationId,
          runtimeOperationKey: "winning-key",
          runtimeOperationKind: "start",
        }),
      );
    });
    mocks.create.mockRejectedValue(new Error("workflow already exists"));
    mocks.getStatus.mockResolvedValue({ status: "running" });

    const response = await queueAzureWorkspaceStart(workspaceId, "retry-key");

    expect(response).toEqual({
      accepted: true,
      operationId: existingOperationId,
      generation: 1,
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("records member activity when a ready ARM guest fails its health probe", async () => {
    mocks.row = workspaceRow({ runtimeStatus: "ready", runtimeGeneration: 4 });
    mocks.healthy.mockResolvedValue(false);

    expect(await touchAzureWorkspaceActivity(workspaceId)).toBe(false);
    expect(mocks.updates).toEqual([{ lastActivityAt: expect.any(Date) }]);
    expect(mocks.healthy).toHaveBeenCalledTimes(1);
  });

  it("does not keep a stopped ARM guest awake", async () => {
    expect(await touchAzureWorkspaceActivity(workspaceId)).toBe(false);
    expect(mocks.updates).toEqual([]);
    expect(mocks.healthy).not.toHaveBeenCalled();
  });
});

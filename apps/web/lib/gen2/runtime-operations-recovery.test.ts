vi.mock("./arm-compute-policy", () => ({
  enforceArmComputeEntitlement: vi.fn(async () => undefined),
}));
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rootDb: null as unknown,
  createDatabase: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  deleteDisk: vi.fn(),
  initialize: vi.fn(),
  reconcileRows: [] as Array<Record<string, unknown>>,
  rootUpdates: [] as Array<Record<string, unknown>>,
  workflowRow: null as Record<string, unknown> | null,
  workflowReads: [] as Array<Array<Record<string, unknown>>>,
  workflowUpdates: [] as Array<Record<string, unknown>>,
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    GEN2_ARM_WORKSPACE_LIFECYCLE: {
      create: (...args: unknown[]) => mocks.create(...args),
      get: (...args: unknown[]) => mocks.get(...args),
    },
  },
}));

vi.mock("@codev/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@codev/db")>()),
  createDatabase: (...args: unknown[]) => mocks.createDatabase(...args),
}));

vi.mock("../platform/database", () => ({
  getDatabase: () => mocks.rootDb,
}));

vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));

vi.mock("../runtime/arm-workspace-provider", () => ({
  ArmWorkspaceProvider: class {
    start(...args: unknown[]) {
      return mocks.start(...args);
    }

    stop(...args: unknown[]) {
      return mocks.stop(...args);
    }

    deleteDisk(...args: unknown[]) {
      return mocks.deleteDisk(...args);
    }
  },
  ArmWorkspaceRuntimeError: class ArmWorkspaceRuntimeError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));

vi.mock("./arm-workspace-initialize", () => ({
  initializeGen2ArmWorkspace: (...args: unknown[]) => mocks.initialize(...args),
}));

import {
  reconcileArmWorkspaceOperations,
  runArmWorkspaceLifecycle,
  type ArmWorkspaceWorkflowParams,
} from "./runtime-operations";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const operationId = "8a149e5a-d974-48d9-a0b3-cb2fa5c537d1";
const diskId = "/subscriptions/s/resourceGroups/r/disks/workspace-data";

function rootDatabase() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => mocks.reconcileRows }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          mocks.rootUpdates.push(values);
          Object.assign(mocks.reconcileRows[0] ?? {}, values);
          return {
            returning: async () => [{ id: workspaceId }],
          };
        },
      }),
    }),
  };
}

function workflowDatabase() {
  return {
    delete: () => ({ where: async () => undefined }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () =>
            mocks.workflowReads.shift() ??
            (mocks.workflowRow ? [mocks.workflowRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          mocks.workflowUpdates.push(values);
          Object.assign(mocks.workflowRow ?? {}, values);
          return { returning: async () => [{ id: workspaceId }] };
        },
      }),
    }),
    transaction: async (callback: (transaction: unknown) => unknown) =>
      callback(workflowDatabase()),
  };
}

function runtimeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: workspaceId,
    ownerId: "owner-1",
    status: "ready",
    runtimeProvider: "azure_arm",
    runtimeStatus: "stopping",
    runtimeGeneration: 2,
    runtimeVmResourceId: "/subscriptions/s/resourceGroups/r/vms/workspace-g2",
    runtimeDiskResourceId: diskId,
    runtimeDiskUuid: "saved-disk-uuid",
    runtimeTunnelId: "tunnel-1",
    runtimeRouteHost: "workspace.trycodev.com",
    runtimeCleanupGeneration: 1,
    runtimeOperationId: operationId,
    runtimeOperationKey: "request-key",
    runtimeOperationKind: "stop",
    runtimeOperationStartedAt: new Date(Date.now() - 10 * 60_000),
    runtimeLeaseExpiresAt: new Date(Date.now() - 1_000),
    ...overrides,
  };
}

function reconcileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: workspaceId,
    runtimeGeneration: 2,
    runtimeOperationId: operationId,
    runtimeOperationKind: "start",
    runtimeOperationStartedAt: new Date(Date.now() - 10 * 60_000),
    runtimeLeaseExpiresAt: new Date(Date.now() - 1_000),
    runtimeCleanupGeneration: null,
    runtimeVmResourceId: null,
    runtimeStatus: "booting",
    ...overrides,
  };
}

const workflowEnv = {
  HYPERDRIVE: {
    connectionString: "postgres://codev:secret@db.example.test/codev",
  },
};
const workflowStep = {
  do: async (
    _name: string,
    _options: unknown,
    callback: () => Promise<unknown>,
  ) => callback(),
};

function params(
  kind: ArmWorkspaceWorkflowParams["kind"],
  overrides: Partial<ArmWorkspaceWorkflowParams> = {},
): ArmWorkspaceWorkflowParams {
  return {
    workspaceId,
    operationId,
    generation: 2,
    resourceGeneration: 2,
    cleanupGeneration: null,
    kind,
    ...overrides,
  };
}

describe("ARM workspace operation recovery", () => {
  beforeEach(() => {
    mocks.reconcileRows = [];
    mocks.rootUpdates = [];
    mocks.workflowRow = runtimeRow();
    mocks.workflowReads = [];
    mocks.workflowUpdates = [];
    mocks.rootDb = rootDatabase();
    mocks.create.mockReset().mockResolvedValue(undefined);
    mocks.get
      .mockReset()
      .mockRejectedValue(new Error("workflow instance missing"));
    mocks.start.mockReset().mockResolvedValue({
      vmId: "new-vm",
      diskId,
      diskUuid: "saved-disk-uuid",
      tunnelId: "tunnel-2",
      routeHost: "workspace.trycodev.com",
    });
    mocks.stop.mockReset().mockResolvedValue(undefined);
    mocks.deleteDisk.mockReset().mockResolvedValue(undefined);
    mocks.initialize.mockReset().mockResolvedValue(undefined);
    mocks.createDatabase.mockReset().mockImplementation(() => ({
      db: workflowDatabase(),
      pool: { end: vi.fn(async () => undefined) },
    }));
  });

  it("recreates a lost workflow with its original ID after its lease expires", async () => {
    const row = reconcileRow({
      runtimeLeaseExpiresAt: new Date(Date.now() - 1),
    });
    mocks.reconcileRows = [row];

    await reconcileArmWorkspaceOperations();

    expect(mocks.get).toHaveBeenCalledWith(operationId);
    expect(mocks.create).toHaveBeenCalledWith({
      id: operationId,
      params: expect.objectContaining({
        workspaceId,
        operationId,
        generation: 2,
        kind: "start",
      }),
    });
    expect(mocks.rootUpdates).toHaveLength(0);
  });

  it("renews an expired lease when the workflow is still running", async () => {
    mocks.get.mockResolvedValue({
      status: async () => ({ status: "running" }),
    });
    mocks.reconcileRows = [reconcileRow()];

    await reconcileArmWorkspaceOperations();

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.rootUpdates).toEqual([
      expect.objectContaining({
        runtimeLeaseExpiresAt: expect.any(Date),
        runtimeOperationStartedAt: expect.any(Date),
      }),
    ]);
  });

  it("replaces a terminal failed-delete workflow before retrying cleanup", async () => {
    const row = reconcileRow({
      runtimeOperationKind: "delete",
      runtimeStatus: "failed",
      runtimeLeaseExpiresAt: null,
    });
    mocks.reconcileRows = [row];
    mocks.get.mockResolvedValue({
      status: async () => ({ status: "complete" }),
    });

    await reconcileArmWorkspaceOperations();

    expect(row.runtimeOperationId).not.toBe(operationId);
    expect(mocks.rootUpdates[0]).toMatchObject({
      runtimeOperationId: row.runtimeOperationId,
    });
    expect(row.runtimeGeneration).toBe(2);
    expect(mocks.create).toHaveBeenCalledWith({
      id: row.runtimeOperationId,
      params: expect.objectContaining({
        operationId: row.runtimeOperationId,
        kind: "delete",
        generation: 2,
      }),
    });
  });

  it("does not let a stale start completion write over a newer operation", async () => {
    const current = runtimeRow({
      status: "provisioning",
      runtimeStatus: "checking_readiness",
      runtimeOperationKind: "start",
    });
    mocks.workflowRow = {
      ...current,
      runtimeOperationId: "newer-operation",
      runtimeGeneration: 3,
    };
    mocks.workflowReads = [[current], [current], [], []];

    await runArmWorkspaceLifecycle(
      workflowEnv as never,
      params("start"),
      workflowStep as never,
    );

    expect(mocks.initialize).toHaveBeenCalledOnce();
    expect(mocks.workflowRow).toMatchObject({
      runtimeOperationId: "newer-operation",
      runtimeGeneration: 3,
    });
    expect(mocks.workflowUpdates).toHaveLength(0);
    expect(mocks.stop).toHaveBeenCalledWith({
      workspaceId,
      generation: 2,
      diskId: null,
      diskUuid: null,
    });
  });

  it("keeps runtime resources recorded when a stop only partly cleans up", async () => {
    mocks.workflowRow = runtimeRow({
      status: "provisioning",
      runtimeOperationKind: "stop",
    });
    mocks.stop.mockImplementation(
      async ({ generation }: { generation: number }) => {
        if (generation === 1) throw new Error("CLOUDFLARE_TUNNEL_FAILED");
      },
    );

    await runArmWorkspaceLifecycle(
      workflowEnv as never,
      params("stop", { cleanupGeneration: 1 }),
      workflowStep as never,
    );

    expect(mocks.stop).toHaveBeenCalledTimes(2);
    expect(mocks.workflowRow).toMatchObject({
      status: "failed",
      runtimeStatus: "failed",
      runtimeOperationId: operationId,
      runtimeDiskResourceId: diskId,
    });
    expect(mocks.workflowUpdates[0]).toMatchObject({
      status: "failed",
      runtimeStatus: "failed",
    });
    expect(mocks.workflowUpdates[0]).not.toHaveProperty(
      "runtimeDiskResourceId",
    );
    expect(mocks.workflowUpdates[0]).not.toHaveProperty("runtimeVmResourceId");
  });

  it("keeps a deleting workspace and saved disk after VM cleanup but failed disk removal", async () => {
    mocks.workflowRow = runtimeRow({
      status: "deleting",
      runtimeOperationKind: "delete",
    });
    mocks.deleteDisk.mockRejectedValue(new Error("DISK_ATTACH_CONFLICT"));

    await runArmWorkspaceLifecycle(
      workflowEnv as never,
      params("delete"),
      workflowStep as never,
    );

    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.deleteDisk).toHaveBeenCalledWith(diskId, workspaceId);
    expect(mocks.workflowRow).toMatchObject({
      status: "deleting",
      runtimeStatus: "failed",
      runtimeOperationId: operationId,
      runtimeDiskResourceId: diskId,
    });
    expect(mocks.workflowUpdates[0]).toMatchObject({
      status: "deleting",
      runtimeStatus: "failed",
      lastError:
        "The saved workspace disk could not be safely attached. Your data was left untouched.",
    });
    expect(mocks.workflowUpdates[0]).not.toHaveProperty(
      "runtimeDiskResourceId",
    );
  });
});

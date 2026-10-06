import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";
import type { ArmWorkspaceWorkflowParams } from "@codev/contracts";

const mocks = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  loseClaim: false,
  events: [] as string[],
}));
vi.mock("./arm-workflow-database", () => ({
  withArmWorkflowDatabase: async (
    _env: unknown,
    action: (db: unknown) => Promise<unknown>,
  ) =>
    action({
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [mocks.row] }) }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              if (mocks.loseClaim) return [];
              mocks.row = { ...mocks.row, ...values };
              mocks.events.push("claimed");
              return [mocks.row];
            },
          }),
        }),
      }),
    }),
}));
import { continueArmWorkspaceWorkflow } from "./arm-workflow-continuation";

const params: ArmWorkspaceWorkflowParams = {
  workspaceId: "a61dc667-3fc5-451f-9f45-9308c8f50376",
  operationId: "11ddc2e2-5e06-45d0-8d99-a631895adb4f",
  generation: 2,
  resourceGeneration: 2,
  cleanupGeneration: null,
  kind: "start",
};
const step = {
  do: async (
    _name: string,
    _options: unknown,
    action: () => Promise<unknown>,
  ) => action(),
} as unknown as WorkflowStep;

function environment() {
  const sendEvent = vi.fn(async () => {
    mocks.events.push("activated");
  });
  const create = vi.fn(async ({ id }: { id: string }) => {
    expect(mocks.row.runtimeOperationId).toBe(id);
    mocks.events.push("created");
  });
  return {
    env: {
      GEN2_ARM_WORKSPACE_LIFECYCLE: {
        create,
        get: vi.fn(async () => ({
          status: async () => ({ status: "waiting" }),
          sendEvent,
        })),
      },
    },
    create,
    sendEvent,
  };
}

describe("ARM workflow continuation handoff", () => {
  beforeEach(() => {
    mocks.row = {
      runtimeOperationId: params.operationId,
      runtimeStatus: "attaching_disk",
      runtimeCleanupGeneration: null,
    };
    mocks.loseClaim = false;
    mocks.events = [];
  });

  it("claims the child before activation and compacts completed lifecycle phases", async () => {
    const { env, create, sendEvent } = environment();
    await continueArmWorkspaceWorkflow(env, params, step, {
      "arm-start-2-1-input": { runtimeStatus: "queued" },
    });
    expect(mocks.events).toEqual(["claimed", "created", "activated"]);
    expect(create).toHaveBeenCalledWith({
      id: mocks.row.runtimeOperationId,
      params: expect.objectContaining({
        activate: true,
        checkpoints: {},
        generation: 2,
      }),
    });
    expect(sendEvent).toHaveBeenCalledWith({
      type: "handoff-ready",
      payload: {},
    });
  });

  it("retains unfinished-phase checkpoints and reuses the same child on retry", async () => {
    const { env, create } = environment();
    const checkpoints = {
      "arm-start-2-1-input": { runtimeStatus: "attaching_disk" },
      "arm-start-2-2-azure": { status: 202 },
    };
    await continueArmWorkspaceWorkflow(env, params, step, checkpoints);
    const id = mocks.row.runtimeOperationId;
    await continueArmWorkspaceWorkflow(env, params, step, checkpoints);
    expect(mocks.row.runtimeOperationId).toBe(id);
    expect(create.mock.calls[1]?.[0]).toMatchObject({
      id,
      params: { checkpoints },
    });
    expect(mocks.events.filter((event) => event === "claimed")).toHaveLength(1);
  });

  it("does not create or activate a child after losing the operation fence", async () => {
    mocks.loseClaim = true;
    const { env, create, sendEvent } = environment();
    await expect(
      continueArmWorkspaceWorkflow(env, params, step, {}),
    ).rejects.toMatchObject({ code: "STALE_OPERATION" });
    expect(create).not.toHaveBeenCalled();
    expect(sendEvent).not.toHaveBeenCalled();
  });
});

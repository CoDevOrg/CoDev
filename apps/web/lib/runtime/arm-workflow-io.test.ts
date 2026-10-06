import { describe, expect, it, vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";
import { ArmWorkflowIO } from "./arm-workflow-io";

function steps() {
  return {
    do: vi.fn(async (_name, _options, action) => action()),
    sleep: vi.fn(async () => undefined),
  };
}

describe("free-plan ARM workflow I/O", () => {
  it("drains parallel branches before handoff and replays them within a shared budget", async () => {
    let release!: () => void;
    const pendingDisk = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mutations: Array<string | number> = [];
    let checkpoints: Record<string, unknown> = {};
    const execute = () =>
      ArmWorkflowIO.parallel([
        () =>
          ArmWorkflowIO.checkpoint("azure", async () => {
            await pendingDisk;
            mutations.push("disk");
            return "disk";
          }),
        async () => {
          try {
            for (let index = 0; index < 12; index++) {
              await ArmWorkflowIO.checkpoint("azure", async () => {
                mutations.push(index);
                return index;
              });
            }
            return "tunnel";
          } finally {
            release();
          }
        },
      ]);
    await ArmWorkflowIO.run(
      steps() as unknown as WorkflowStep,
      "start",
      {},
      async () => {
        await expect(execute()).rejects.toMatchObject({
          code: "WORKFLOW_CONTINUE",
        });
        checkpoints = JSON.parse(JSON.stringify(ArmWorkflowIO.saved()));
      },
    );
    expect(mutations).toHaveLength(10);
    expect(Object.values(checkpoints)).toContain("disk");
    await ArmWorkflowIO.run(
      steps() as unknown as WorkflowStep,
      "start",
      checkpoints,
      async () => {
        await expect(execute()).resolves.toEqual(["disk", "tunnel"]);
      },
    );
    expect(mutations.filter((value) => value === "disk")).toHaveLength(1);
    expect(mutations.filter((value) => typeof value === "number")).toEqual(
      Array.from({ length: 12 }, (_, index) => index),
    );
  });

  it("hands off and replays completed requests without repeating mutations", async () => {
    let checkpoints: Record<string, unknown> = {};
    const mutations: number[] = [];
    const segmentCounts: number[] = [];
    let complete = false;
    while (!complete) {
      const before = mutations.length;
      await ArmWorkflowIO.run(
        steps() as unknown as WorkflowStep,
        "start",
        checkpoints,
        async () => {
          try {
            for (let index = 0; index < 31; index++) {
              const { response, payload } = await ArmWorkflowIO.request(
                "azure",
                async () => {
                  mutations.push(index);
                  return {
                    response: new Response(null, {
                      status: 202,
                      headers: {
                        "azure-asyncoperation":
                          "https://management.azure.com/poll",
                      },
                    }),
                    payload: { index },
                  };
                },
              );
              expect(response.status).toBe(202);
              expect(response.headers.get("azure-asyncoperation")).toContain(
                "/poll",
              );
              expect(payload.index).toBe(index);
              await ArmWorkflowIO.sleep(15_000);
            }
            complete = true;
          } catch (error) {
            expect(error).toMatchObject({ code: "WORKFLOW_CONTINUE" });
            checkpoints = JSON.parse(JSON.stringify(ArmWorkflowIO.saved()));
          }
        },
      );
      segmentCounts.push(mutations.length - before);
    }
    expect(segmentCounts).toEqual([10, 10, 10, 1]);
    expect(mutations).toEqual(Array.from({ length: 31 }, (_, index) => index));
  });

  it("preserves deadlines and does not repeat completed waits on continuation", async () => {
    const first = steps();
    let checkpoints: Record<string, unknown> = {};
    let deadline = 0;
    await ArmWorkflowIO.run(
      first as unknown as WorkflowStep,
      "start",
      {},
      async () => {
        deadline = await ArmWorkflowIO.deadline(600_000);
        await ArmWorkflowIO.sleep(10_000);
        checkpoints = ArmWorkflowIO.saved();
      },
    );
    const second = steps();
    await ArmWorkflowIO.run(
      second as unknown as WorkflowStep,
      "start",
      checkpoints,
      async () => {
        expect(await ArmWorkflowIO.deadline(600_000)).toBe(deadline);
        await ArmWorkflowIO.sleep(10_000);
      },
    );
    expect(second.do).not.toHaveBeenCalled();
    expect(second.sleep).not.toHaveBeenCalled();
  });

  it("does not create nested workflow steps inside a database progress checkpoint", async () => {
    const step = steps();
    await ArmWorkflowIO.run(step as unknown as WorkflowStep, "start", {}, () =>
      ArmWorkflowIO.checkpoint("progress", () =>
        ArmWorkflowIO.request("azure", async () => ({
          response: new Response(null),
          payload: null,
        })),
      ),
    );
    expect(step.do).toHaveBeenCalledOnce();
  });
});

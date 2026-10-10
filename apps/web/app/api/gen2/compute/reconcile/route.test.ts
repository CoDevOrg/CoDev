import { afterEach, expect, it, vi } from "vitest";

const reconcile = vi.hoisted(() =>
  vi.fn(async () => ({ checked: 2, stopped: 1 })),
);
const reconcileArmWorkspaceOperations = vi.hoisted(() => vi.fn());
const sweepArmWorkspacePreviewRoutes = vi.hoisted(() => vi.fn());
vi.mock("@/lib/gen2/compute-reconcile", () => ({
  reconcileComputeQuota: reconcile,
}));
vi.mock("@/lib/gen2/runtime-operations", () => ({
  reconcileArmWorkspaceOperations,
}));
vi.mock("@/lib/runtime/arm-workspace-preview-sweep", () => ({
  sweepArmWorkspacePreviewRoutes,
}));

import { GET } from "./route";

afterEach(() => {
  delete process.env.CRON_SECRET;
  reconcile.mockClear();
  reconcileArmWorkspaceOperations.mockClear();
  sweepArmWorkspacePreviewRoutes.mockClear();
});

it("requires the scheduler secret before reconciling and stopping workspaces", async () => {
  process.env.CRON_SECRET = "scheduler-secret-with-at-least-32-characters";
  expect(
    (await GET(new Request("http://localhost/api/gen2/compute/reconcile")))
      .status,
  ).toBe(401);
  expect(
    (
      await GET(
        new Request("http://localhost/api/gen2/compute/reconcile", {
          headers: { authorization: "Bearer wrong" },
        }),
      )
    ).status,
  ).toBe(401);
  expect(reconcile).not.toHaveBeenCalled();
  const response = await GET(
    new Request("http://localhost/api/gen2/compute/reconcile", {
      headers: {
        authorization: "Bearer scheduler-secret-with-at-least-32-characters",
      },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ checked: 2, stopped: 1 });
  expect(reconcileArmWorkspaceOperations).toHaveBeenCalledOnce();
  expect(sweepArmWorkspacePreviewRoutes).toHaveBeenCalledOnce();
});

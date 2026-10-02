import { afterEach, expect, it, vi } from "vitest";

const reconcile = vi.hoisted(() =>
  vi.fn(async () => ({ checked: 2, stopped: 1 })),
);
vi.mock("@/lib/gen2/compute-reconcile", () => ({
  reconcileComputeQuota: reconcile,
}));

import { GET } from "./route";

afterEach(() => {
  delete process.env.CRON_SECRET;
  reconcile.mockClear();
});

it("requires the scheduler secret before reconciling and stopping workspaces", async () => {
  process.env.CRON_SECRET = "scheduler-secret";
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
      headers: { authorization: "Bearer scheduler-secret" },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ checked: 2, stopped: 1 });
});

import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  row: {} as Record<string, unknown> | undefined,
  poolClosed: false,
}));
vi.mock("../platform/database", () => ({
  getDatabase: () => {
    if (mocks.poolClosed)
      throw new Error("Cannot use a pool after calling end");
    return {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => (mocks.row ? [mocks.row] : []) }),
        }),
      }),
    };
  },
}));
import { workspaceRuntimeTarget } from "./workspace-runtime-target";
const id = "a61dc667-3fc5-451f-9f45-9308c8f50376";
const host = `codev-${createHash("sha256").update(id).digest("hex").slice(0, 20)}-g2.trycodev.com`;
beforeEach(() => {
  mocks.poolClosed = false;
  mocks.row = { provider: "azure_arm", status: "ready", generation: 2, host };
});
it("binds the route to this workspace and current generation", async () => {
  expect(await workspaceRuntimeTarget(id)).toEqual({
    workspaceId: id,
    host,
    generation: 2,
  });
  mocks.row!.generation = 3;
  await expect(workspaceRuntimeTarget(id)).rejects.toMatchObject({
    status: 503,
  });
});
it("refuses arbitrary endpoints, missing rows and stopped guests", async () => {
  mocks.row!.host = "attacker.test";
  await expect(workspaceRuntimeTarget(id)).rejects.toMatchObject({
    status: 503,
  });
  mocks.row!.status = "stopping";
  await expect(workspaceRuntimeTarget(id)).rejects.toMatchObject({
    status: 409,
  });
  mocks.row = undefined;
  await expect(workspaceRuntimeTarget(id)).rejects.toMatchObject({
    status: 404,
  });
});
it("selects the existing host for Firecracker workspaces", async () => {
  mocks.row!.provider = "firecracker";
  expect(await workspaceRuntimeTarget(id)).toBeNull();
});

it("uses the caller transaction even if the request pool is already closed", async () => {
  mocks.poolClosed = true;
  const transaction = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [mocks.row] }),
      }),
    }),
  } as unknown as NonNullable<Parameters<typeof workspaceRuntimeTarget>[1]>;
  expect(await workspaceRuntimeTarget(id, transaction)).toEqual({
    workspaceId: id,
    host,
    generation: 2,
  });
});

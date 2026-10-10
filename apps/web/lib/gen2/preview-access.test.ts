import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  row: undefined as Record<string, unknown> | undefined,
  queries: 0,
}));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => {
              mocks.queries += 1;
              return mocks.row ? [mocks.row] : [];
            },
          }),
        }),
      }),
    }),
  }),
}));

import { gen2PreviewAccess } from "./preview-access";

const runtime = {
  provider: "azure_arm",
  status: "ready",
  generation: 2,
  host: "codev-a-g2.trycodev.com",
  tunnelId: "tunnel-a",
};

beforeEach(() => {
  mocks.queries = 0;
  mocks.row = { role: "editor", workspaceStatus: "ready", ...runtime };
});

it("returns the route and tunnel from one membership read", async () => {
  expect(await gen2PreviewAccess("workspace-a", "user-a")).toEqual(runtime);
  expect(mocks.queries).toBe(1);
});

it("rejects viewers, non-members and deleting workspaces", async () => {
  mocks.row!.role = "viewer";
  await expect(
    gen2PreviewAccess("workspace-a", "user-a"),
  ).rejects.toMatchObject({
    status: 403,
    message: "Only editors can open previews.",
  });
  mocks.row = undefined;
  await expect(
    gen2PreviewAccess("workspace-a", "user-a"),
  ).rejects.toMatchObject({ status: 404 });
  mocks.row = { role: "owner", workspaceStatus: "deleting", ...runtime };
  await expect(
    gen2PreviewAccess("workspace-a", "user-a"),
  ).rejects.toMatchObject({ status: 409 });
});

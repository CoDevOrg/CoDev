import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  row: undefined as Record<string, unknown> | undefined,
  queries: 0,
}));
vi.mock("server-only", () => ({}));
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

import { gen2TerminalAccess } from "./terminal-access";

const runtime = {
  provider: "azure_arm",
  status: "ready",
  generation: 2,
  host: "codev-a-g2.trycodev.com",
};

beforeEach(() => {
  mocks.queries = 0;
  mocks.row = { role: "editor", workspaceStatus: "ready", ...runtime };
});

it("returns the guest route from the same live membership read", async () => {
  expect(await gen2TerminalAccess("workspace-a", "user-a")).toEqual(runtime);
  expect(mocks.queries).toBe(1);
});

it("rejects viewers, removed members and deleting workspaces on every call", async () => {
  await gen2TerminalAccess("workspace-a", "user-a");
  mocks.row!.role = "viewer";
  await expect(
    gen2TerminalAccess("workspace-a", "user-a"),
  ).rejects.toMatchObject({ status: 403 });
  mocks.row = undefined;
  await expect(
    gen2TerminalAccess("workspace-a", "user-a"),
  ).rejects.toMatchObject({ status: 404 });
  mocks.row = { role: "owner", workspaceStatus: "deleting", ...runtime };
  await expect(
    gen2TerminalAccess("workspace-a", "user-a"),
  ).rejects.toMatchObject({ status: 409 });
  expect(mocks.queries).toBe(4);
});

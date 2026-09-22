import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  membership: [] as Array<{ role: "owner" | "editor" | "viewer" }>,
}));

vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.membership,
        }),
      }),
    }),
  }),
}));

import { getWorkspaceAccess, requireWorkspacePermission } from "./workspace";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-822222222222";

describe("workspace policy access", () => {
  beforeEach(() => {
    mocks.membership = [];
  });

  it("resolves authority from the stored membership role", async () => {
    mocks.membership = [{ role: "editor" }];

    await expect(getWorkspaceAccess(workspaceId, userId)).resolves.toEqual({
      role: "editor",
      capabilities: expect.objectContaining({
        "workspace.editFiles": true,
        "member.invite": false,
      }),
    });
  });

  it("does not manufacture access for a non-member", async () => {
    await expect(getWorkspaceAccess(workspaceId, userId)).resolves.toBeNull();
    await expect(
      requireWorkspacePermission(workspaceId, userId, "workspace.view"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a member missing the requested capability", async () => {
    mocks.membership = [{ role: "viewer" }];

    await expect(
      requireWorkspacePermission(workspaceId, userId, "workspace.useTerminal"),
    ).rejects.toMatchObject({
      status: 403,
      message: "You don't have permission to perform this action.",
    });
  });

  it("returns resolved capabilities after a successful guard", async () => {
    mocks.membership = [{ role: "owner" }];

    await expect(
      requireWorkspacePermission(workspaceId, userId, "workspace.managePolicy"),
    ).resolves.toMatchObject({
      role: "owner",
      capabilities: { "workspace.managePolicy": true },
    });
  });
});

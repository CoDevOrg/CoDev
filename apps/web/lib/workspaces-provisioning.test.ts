import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectQuery = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    for: vi.fn(),
  };
  const insertQuery = {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
  };
  const updateQuery = {
    set: vi.fn(),
    where: vi.fn(),
  };
  const transaction = {
    select: vi.fn(() => selectQuery),
    insert: vi.fn(() => insertQuery),
    update: vi.fn(() => updateQuery),
  };
  type Transaction = typeof transaction;
  const database = {
    transaction: vi.fn(
      async (callback: (transaction: Transaction) => unknown) =>
        callback(transaction),
    ),
  };

  for (const method of ["from", "leftJoin", "where", "limit"] as const) {
    selectQuery[method].mockReturnValue(selectQuery);
  }
  insertQuery.values.mockReturnValue(insertQuery);
  updateQuery.set.mockReturnValue(updateQuery);
  updateQuery.where.mockResolvedValue(undefined);
  insertQuery.onConflictDoUpdate.mockResolvedValue(undefined);

  return {
    database,
    requireWorkspacePermission: vi.fn(),
    selectQuery,
  };
});

vi.mock("./database", () => ({
  getDatabase: () => mocks.database,
}));

vi.mock("./access", () => ({
  getWorkspaceAccess: vi.fn(),
  requireWorkspacePermission: mocks.requireWorkspacePermission,
  WorkspaceAccessError: class WorkspaceAccessError extends Error {},
  writeWorkspaceTuple: vi.fn(),
}));

vi.mock("./audit", () => ({ appendWorkspaceEvent: vi.fn() }));
vi.mock("./crypto", () => ({
  createInviteToken: vi.fn(),
  hashInviteToken: vi.fn(),
}));
vi.mock("./github", () => ({ getRepository: vi.fn() }));
vi.mock("./settings-access", () => ({
  requireOrganizationSettingsWrite: vi.fn(),
}));
vi.mock("./quotas", () => ({ assertWorkspaceQuota: vi.fn() }));
vi.mock("./workspace-lifecycle", () => ({
  hasUnpublishedRuntimeChanges: vi.fn(),
  workspaceSyncBlockReason: vi.fn(),
}));

import { beginWorkspaceProvisioning } from "./workspaces";
import { schema } from "@codev/db";

describe("beginWorkspaceProvisioning", () => {
  beforeEach(() => {
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.selectQuery.for.mockResolvedValue([
      { workspaceStatus: "ready", runtimeStatus: "stopped" },
    ]);
  });

  it("locks only the workspace row across the nullable runtime join", async () => {
    await beginWorkspaceProvisioning("workspace-1", "user-1");

    expect(mocks.selectQuery.for).toHaveBeenCalledWith("update", {
      of: schema.workspaces,
    });
  });
});

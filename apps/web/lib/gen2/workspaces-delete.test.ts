import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const member = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Failed workspace",
    status: "failed",
    sandboxId: null,
    lastError: "Firecracker host could not be reached.",
    role: "owner" as const,
    repository: null,
    repositoryPrivate: null,
    defaultBranch: null,
    createdAt: new Date("2026-09-20T20:00:00.000Z"),
    updatedAt: new Date("2026-09-20T20:00:00.000Z"),
  };
  const selectQuery = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  selectQuery.from.mockReturnValue(selectQuery);
  selectQuery.innerJoin.mockReturnValue(selectQuery);
  selectQuery.where.mockReturnValue(selectQuery);
  selectQuery.limit.mockResolvedValue([member]);
  const deleteQuery = { where: vi.fn().mockResolvedValue(undefined) };

  return {
    destroySandbox: vi.fn(),
    logEvent: vi.fn(),
    selectQuery,
    deleteQuery,
    database: {
      select: vi.fn(() => selectQuery),
      delete: vi.fn(() => deleteQuery),
    },
  };
});

vi.mock("../platform/database", () => ({
  getDatabase: () => mocks.database,
}));

vi.mock("../platform/crypto", () => ({
  createInviteToken: vi.fn(),
  hashInviteToken: vi.fn(),
}));

vi.mock("../platform/observability", () => ({
  logEvent: (...args: unknown[]) => mocks.logEvent(...args),
}));

vi.mock("../runtime/orchestrator-sandbox", () => ({
  destroySandbox: (...args: unknown[]) => mocks.destroySandbox(...args),
}));

import { deleteGen2Workspace } from "./workspaces";

describe("Gen 2 workspace deletion", () => {
  beforeEach(() => {
    mocks.destroySandbox.mockReset();
    mocks.logEvent.mockReset();
    mocks.database.delete.mockClear();
    mocks.deleteQuery.where.mockClear();
  });

  it("deletes a failed workspace when its stopped host cannot be reached", async () => {
    mocks.destroySandbox.mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      deleteGen2Workspace("11111111-1111-4111-8111-111111111111", "user-1"),
    ).resolves.toBeUndefined();

    expect(mocks.database.delete).toHaveBeenCalledOnce();
    expect(mocks.logEvent).toHaveBeenCalledWith(
      "warn",
      "gen2.workspace.delete_host_unreachable",
      expect.objectContaining({
        workspaceId: "11111111-1111-4111-8111-111111111111",
      }),
    );
  });

  it("does not delete the workspace after a reachable-host teardown failure", async () => {
    mocks.destroySandbox.mockRejectedValue(new Error("guest refused teardown"));

    await expect(
      deleteGen2Workspace("11111111-1111-4111-8111-111111111111", "user-1"),
    ).rejects.toThrow("guest refused teardown");

    expect(mocks.database.delete).not.toHaveBeenCalled();
  });
});

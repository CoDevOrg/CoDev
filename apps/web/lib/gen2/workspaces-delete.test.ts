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
  const memberSelect = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  memberSelect.from.mockReturnValue(memberSelect);
  memberSelect.innerJoin.mockReturnValue(memberSelect);
  memberSelect.where.mockReturnValue(memberSelect);
  memberSelect.limit.mockResolvedValue([member]);

  const lockedRows = [{ ownerId: "user-1", status: "failed" }];
  const lockQuery = { for: vi.fn().mockResolvedValue(lockedRows) };
  const lockWhere = { where: vi.fn(() => lockQuery) };
  const lockSelect = { from: vi.fn(() => lockWhere) };
  const updateQuery = { where: vi.fn().mockResolvedValue(undefined) };
  const updateSet = { set: vi.fn(() => updateQuery) };
  const transaction = {
    select: vi.fn(() => lockSelect),
    update: vi.fn(() => updateSet),
  };
  const deleteQuery = { where: vi.fn().mockResolvedValue(undefined) };
  const databaseUpdateQuery = { where: vi.fn().mockResolvedValue(undefined) };
  const databaseUpdateSet = { set: vi.fn(() => databaseUpdateQuery) };

  return {
    destroySandbox: vi.fn(),
    discardSandboxSnapshot: vi.fn(),
    ensureHostReady: vi.fn(),
    logEvent: vi.fn(),
    memberSelect,
    deleteQuery,
    databaseUpdateQuery,
    transaction,
    database: {
      transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback(transaction),
      ),
      select: vi.fn(() => memberSelect),
      delete: vi.fn(() => deleteQuery),
      update: vi.fn(() => databaseUpdateSet),
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

vi.mock("../runtime/orchestrator-health", () => ({
  ensureHostReady: (...args: unknown[]) => mocks.ensureHostReady(...args),
}));

vi.mock("../runtime/orchestrator-sandbox", () => ({
  destroySandbox: (...args: unknown[]) => mocks.destroySandbox(...args),
  discardSandboxSnapshot: (...args: unknown[]) =>
    mocks.discardSandboxSnapshot(...args),
}));

import { deleteGen2Workspace } from "./workspaces";

describe("Gen 2 workspace deletion", () => {
  beforeEach(() => {
    mocks.destroySandbox.mockReset();
    mocks.discardSandboxSnapshot.mockReset();
    mocks.ensureHostReady.mockReset();
    mocks.logEvent.mockReset();
    mocks.database.delete.mockClear();
    mocks.deleteQuery.where.mockClear();
    mocks.database.update.mockClear();
    mocks.databaseUpdateQuery.where.mockClear();
  });

  it("readies the host before purging workspace data", async () => {
    await expect(
      deleteGen2Workspace("11111111-1111-4111-8111-111111111111", "user-1"),
    ).resolves.toBeUndefined();

    expect(mocks.ensureHostReady).toHaveBeenCalledOnce();
    expect(mocks.ensureHostReady).toHaveBeenCalledWith(120_000);
    expect(mocks.destroySandbox).toHaveBeenCalledOnce();
    expect(mocks.discardSandboxSnapshot).toHaveBeenCalledOnce();
    expect(mocks.database.delete).toHaveBeenCalledOnce();
    expect(mocks.ensureHostReady.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.destroySandbox.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps the workspace retryable after a teardown failure", async () => {
    mocks.destroySandbox.mockRejectedValue(new Error("guest refused teardown"));

    await expect(
      deleteGen2Workspace("11111111-1111-4111-8111-111111111111", "user-1"),
    ).rejects.toMatchObject({
      message:
        "Couldn't fully delete this workspace. Retry deletion from the workspace list.",
      status: 502,
    });

    expect(mocks.discardSandboxSnapshot).not.toHaveBeenCalled();
    expect(mocks.database.delete).not.toHaveBeenCalled();
    expect(mocks.database.update).toHaveBeenCalledOnce();
  });

  it("keeps deletion retryable when the host does not wake in time", async () => {
    mocks.ensureHostReady.mockRejectedValue(
      new Error("The Firecracker host is still starting."),
    );

    await expect(
      deleteGen2Workspace("11111111-1111-4111-8111-111111111111", "user-1"),
    ).rejects.toMatchObject({ status: 502 });

    expect(mocks.ensureHostReady).toHaveBeenCalledWith(120_000);
    expect(mocks.destroySandbox).not.toHaveBeenCalled();
    expect(mocks.discardSandboxSnapshot).not.toHaveBeenCalled();
    expect(mocks.database.delete).not.toHaveBeenCalled();
    expect(mocks.database.update).toHaveBeenCalledOnce();
  });
});

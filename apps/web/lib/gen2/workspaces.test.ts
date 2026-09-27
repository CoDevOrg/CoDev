import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inserted: [] as Array<{ table: string; values: Record<string, unknown> }>,
  events: [] as string[],
  failCreate: false,
  failDiscard: false,
  ownedCount: 0,
  currentStatus: "pending",
  memberStatus: "pending",
  memberRole: "owner",
  memberLastError: null as string | null,
  createInviteToken: vi.fn(() => "share-token"),
  hashInviteToken: vi.fn((token: string) => `hash:${token}`),
  ensureHostReady: vi.fn(async () => {
    mocks.events.push("wake-host");
  }),
  destroySandbox: vi.fn(async () => {
    mocks.events.push("destroy");
  }),
  discardSandboxSnapshot: vi.fn(async () => {
    mocks.events.push("discard-snapshot");
    if (mocks.failDiscard) throw new Error("orchestrator unavailable");
  }),
}));

vi.mock("../platform/crypto", () => ({
  createInviteToken: mocks.createInviteToken,
  hashInviteToken: mocks.hashInviteToken,
}));

vi.mock("../platform/observability", () => ({
  logEvent: vi.fn(),
}));

vi.mock("../runtime/orchestrator-health", () => ({
  ensureHostReady: mocks.ensureHostReady,
}));

vi.mock("../runtime/orchestrator-sandbox", () => ({
  destroySandbox: mocks.destroySandbox,
  discardSandboxSnapshot: mocks.discardSandboxSnapshot,
}));

vi.mock("../platform/database", () => {
  function selectedRows(
    table: Parameters<typeof getTableName>[0],
    selection: Record<string, unknown>,
  ) {
    const tableName = getTableName(table);
    if (tableName === "users") return [{ id: "user-1" }];
    if ("count" in selection) return [{ count: mocks.ownedCount }];
    return [{ ownerId: "user-1", status: mocks.currentStatus }];
  }

  function update(table: Parameters<typeof getTableName>[0]) {
    return {
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          mocks.events.push(`update:${getTableName(table)}`);
          if (values.status) mocks.currentStatus = String(values.status);
          if (values.lastError)
            mocks.memberLastError = String(values.lastError);
        },
      }),
    };
  }

  return {
    getDatabase: () => ({
      transaction: async (callback: (transaction: unknown) => unknown) => {
        if (mocks.failCreate) {
          throw new Error(
            'Failed query: insert into "gen2_workspaces" params: [user-1,Workspace]',
          );
        }
        const transaction = {
          select: (selection: Record<string, unknown>) => ({
            from: (table: Parameters<typeof getTableName>[0]) => ({
              where: () => {
                const rows = selectedRows(table, selection);
                if ("count" in selection) mocks.events.push("count-owned");
                return Object.assign(Promise.resolve(rows), {
                  for: async () => {
                    mocks.events.push(
                      getTableName(table) === "users"
                        ? "lock-owner"
                        : "lock-delete-row",
                    );
                    return rows;
                  },
                });
              },
            }),
          }),
          insert: (table: Parameters<typeof getTableName>[0]) => ({
            values: (values: Record<string, unknown>) => {
              const tableName = getTableName(table);
              mocks.events.push(`insert:${tableName}`);
              mocks.inserted.push({ table: tableName, values });
              if (tableName === "gen2_workspaces") {
                return {
                  returning: async () => [
                    {
                      id: "11111111-1111-4111-8111-111111111111",
                      status: "pending",
                      sandboxId: null,
                      lastError: null,
                      createdAt: new Date("2026-09-20T20:00:00.000Z"),
                      updatedAt: new Date("2026-09-20T20:00:00.000Z"),
                      ...values,
                    },
                  ],
                };
              }
              return Promise.resolve();
            },
          }),
          update,
        };
        return callback(transaction);
      },
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: async () => [
                {
                  id: "11111111-1111-4111-8111-111111111111",
                  name: "Studio",
                  status: mocks.memberStatus,
                  sandboxId: null,
                  lastError: mocks.memberLastError,
                  role: mocks.memberRole,
                  repository: null,
                  repositoryPrivate: false,
                  defaultBranch: null,
                  createdAt: new Date("2026-09-20T20:00:00.000Z"),
                  updatedAt: new Date("2026-09-20T20:00:00.000Z"),
                },
              ],
            }),
          }),
        }),
      }),
      update,
      delete: () => ({
        where: async () => {
          mocks.events.push("delete-row");
        },
      }),
    }),
  };
});

import {
  createGen2Workspace,
  defaultGen2WorkspaceName,
  deleteGen2Workspace,
} from "./workspaces";

describe("gen2 workspaces", () => {
  beforeEach(() => {
    mocks.inserted.length = 0;
    mocks.events.length = 0;
    mocks.failCreate = false;
    mocks.failDiscard = false;
    mocks.ownedCount = 0;
    mocks.currentStatus = "pending";
    mocks.memberStatus = "pending";
    mocks.memberRole = "owner";
    mocks.memberLastError = null;
    vi.clearAllMocks();
  });

  it("defaults the name when none is given", () => {
    expect(defaultGen2WorkspaceName()).toBe("Workspace");
    expect(defaultGen2WorkspaceName("  Studio  ")).toBe("Studio");
  });

  it("locks the owner before counting and creating a workspace", async () => {
    const workspace = await createGen2Workspace("user-1", "Studio");
    expect(workspace).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Studio",
      status: "pending",
      role: "owner",
      sandboxId: null,
    });
    expect(mocks.events.slice(0, 3)).toEqual([
      "lock-owner",
      "count-owned",
      "insert:gen2_workspaces",
    ]);
    expect(mocks.inserted).toEqual([
      {
        table: "gen2_workspaces",
        values: { ownerId: "user-1", name: "Studio" },
      },
      {
        table: "gen2_workspace_members",
        values: {
          workspaceId: "11111111-1111-4111-8111-111111111111",
          userId: "user-1",
          role: "owner",
        },
      },
    ]);
  });

  it("rejects a third owned workspace without writing rows", async () => {
    mocks.ownedCount = 2;
    await expect(createGen2Workspace("user-1")).rejects.toMatchObject({
      message:
        "You can own up to 2 Gen 2 workspaces. Delete one to create another.",
      status: 409,
    });
    expect(mocks.inserted).toHaveLength(0);
  });

  it("stops the guest and purges its snapshot before deleting the row", async () => {
    mocks.currentStatus = "ready";
    mocks.memberStatus = "ready";
    await deleteGen2Workspace("11111111-1111-4111-8111-111111111111", "user-1");
    expect(mocks.events).toEqual([
      "lock-delete-row",
      "update:gen2_workspaces",
      "wake-host",
      "destroy",
      "discard-snapshot",
      "delete-row",
    ]);
  });

  it("does not wake the host for a workspace that never started", async () => {
    await deleteGen2Workspace("11111111-1111-4111-8111-111111111111", "user-1");
    expect(mocks.events).toEqual([
      "lock-delete-row",
      "update:gen2_workspaces",
      "delete-row",
    ]);
    expect(mocks.ensureHostReady).not.toHaveBeenCalled();
  });

  it("wakes a stopped host before purging the snapshot", async () => {
    mocks.currentStatus = "stopped";
    mocks.memberStatus = "stopped";

    await deleteGen2Workspace("11111111-1111-4111-8111-111111111111", "user-1");

    expect(mocks.events).toEqual([
      "lock-delete-row",
      "update:gen2_workspaces",
      "wake-host",
      "destroy",
      "discard-snapshot",
      "delete-row",
    ]);
    expect(mocks.ensureHostReady).toHaveBeenCalledOnce();
  });

  it("keeps failed deletions retryable and only then frees the slot", async () => {
    mocks.currentStatus = "ready";
    mocks.memberStatus = "ready";
    mocks.failDiscard = true;
    await expect(
      deleteGen2Workspace("11111111-1111-4111-8111-111111111111", "user-1"),
    ).rejects.toMatchObject({ status: 502 });
    expect(mocks.events).not.toContain("delete-row");
    expect(mocks.memberLastError).toMatch(/Retry deletion/);

    mocks.failDiscard = false;
    mocks.memberStatus = "deleting";
    mocks.currentStatus = "deleting";
    await deleteGen2Workspace("11111111-1111-4111-8111-111111111111", "user-1");
    expect(mocks.events).toContain("delete-row");
  });

  it("does not delete a workspace while it is provisioning", async () => {
    mocks.memberStatus = "provisioning";
    await expect(
      deleteGen2Workspace("11111111-1111-4111-8111-111111111111", "user-1"),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.destroySandbox).not.toHaveBeenCalled();
  });

  it("does not surface the database query when creation fails", async () => {
    mocks.failCreate = true;
    await expect(createGen2Workspace("user-1")).rejects.toMatchObject({
      message: "Couldn't create this workspace.",
      status: 500,
    });
  });
});

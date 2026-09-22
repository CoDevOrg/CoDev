import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inserted: [] as Array<{ table: string; values: Record<string, unknown> }>,
  failCreate: false,
  createInviteToken: vi.fn(() => "share-token"),
  hashInviteToken: vi.fn((token: string) => `hash:${token}`),
}));

vi.mock("../platform/crypto", () => ({
  createInviteToken: mocks.createInviteToken,
  hashInviteToken: mocks.hashInviteToken,
}));

vi.mock("../platform/observability", () => ({
  logEvent: vi.fn(),
}));

vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    transaction: async (callback: (transaction: unknown) => unknown) => {
      if (mocks.failCreate) {
        throw new Error(
          'Failed query: insert into "gen2_workspaces" params: [user-1,Workspace]',
        );
      }
      const transaction = {
        insert: (table: Parameters<typeof getTableName>[0]) => ({
          values: (values: Record<string, unknown>) => {
            const tableName = getTableName(table);
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
      };
      return callback(transaction);
    },
  }),
}));

import { createGen2Workspace, defaultGen2WorkspaceName } from "./workspaces";

describe("gen2 workspace creation", () => {
  beforeEach(() => {
    mocks.inserted.length = 0;
    mocks.failCreate = false;
  });

  it("defaults the name when none is given", () => {
    expect(defaultGen2WorkspaceName()).toBe("Workspace");
    expect(defaultGen2WorkspaceName("  Studio  ")).toBe("Studio");
  });

  it("creates a workspace row and an owner membership", async () => {
    const workspace = await createGen2Workspace("user-1", "Studio");
    expect(workspace).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Studio",
      status: "pending",
      role: "owner",
      sandboxId: null,
      capabilities: {
        "workspace.managePolicy": true,
        "agent.cancelAny": true,
      },
    });
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

  it("does not surface the database query when creation fails", async () => {
    mocks.failCreate = true;
    await expect(createGen2Workspace("user-1")).rejects.toMatchObject({
      message: "Couldn't create this workspace.",
      status: 500,
    });
  });
});

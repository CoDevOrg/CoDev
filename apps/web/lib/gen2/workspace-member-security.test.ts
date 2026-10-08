import { getTableName } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const mocks = vi.hoisted(() => ({
  role: "editor",
  invite: true,
  events: [] as string[],
  sets: [] as Record<string, unknown>[],
}));
vi.mock("../platform/database", () => {
  const database = {
    transaction: async (action: (tx: unknown) => unknown) => action(database),
    select: (fields: Record<string, unknown>) => {
      let table = "";
      function rows() {
        if ("sandboxId" in fields)
          return [
            {
              id: "11111111-1111-4111-8111-111111111111",
              name: "Workspace",
              status: "ready",
              role: mocks.role,
              sandboxId: null,
              lastError: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ];
        if ("expiresAt" in fields)
          return mocks.invite
            ? [
                {
                  expiresAt: new Date(Date.now() + 60000),
                  role: "editor",
                  status: "ready",
                },
              ]
            : [];
        if ("activeInviteExpiresAt" in fields)
          return [
            {
              id: "11111111-1111-4111-8111-111111111111",
              ownerId: "owner",
              status: "ready",
              activeInviteRole: "editor",
              activeInviteExpiresAt: new Date(Date.now() + 60000),
            },
          ];
        if (table === "users") return [{ id: "target", login: "target" }];
        if ("ownerId" in fields) return [{ ownerId: "owner" }];
        return [{ userId: "target", role: "viewer" }];
      }
      const query = {
        from: (value: Parameters<typeof getTableName>[0]) => {
          table = getTableName(value);
          return query;
        },
        innerJoin: () => query,
        where: () => query,
        limit: async () => rows(),
        orderBy: async () => rows(),
        for: async () => {
          mocks.events.push("lock-workspace");
          return rows();
        },
      };
      return query;
    },
    update: (table: Parameters<typeof getTableName>[0]) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          mocks.events.push(`update:${getTableName(table)}`);
          mocks.sets.push(values);
          if ("activeInviteTokenHash" in values) mocks.invite = false;
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        mocks.events.push("delete-member");
      },
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => {
          mocks.events.push("join-member");
        },
      }),
    }),
  };
  return { getDatabase: () => database };
});
vi.mock("../platform/crypto", () => ({
  createInviteToken: vi.fn(),
  hashInviteToken: (token: string) => token,
}));
import {
  addGen2WorkspaceMember,
  joinGen2Workspace,
  removeGen2WorkspaceMember,
} from "./workspaces";

beforeEach(() => {
  mocks.role = "editor";
  mocks.invite = true;
  mocks.events.length = 0;
  mocks.sets.length = 0;
});
it("rejects editor role changes through add-member", async () => {
  await expect(
    addGen2WorkspaceMember(workspaceId, "editor", "target", "editor"),
  ).rejects.toMatchObject({ status: 403 });
  expect(mocks.sets).toEqual([]);
});
it("allows owners to change existing non-owner roles", async () => {
  mocks.role = "owner";
  await addGen2WorkspaceMember(workspaceId, "owner", "target", "editor");
  expect(mocks.sets).toContainEqual({ role: "editor" });
});
it("revokes invites atomically with removal and blocks a retained or concurrently read invite", async () => {
  mocks.role = "owner";
  await removeGen2WorkspaceMember(workspaceId, "owner", "target");
  expect(mocks.events.slice(0, 3)).toEqual([
    "lock-workspace",
    "update:gen2_workspaces",
    "delete-member",
  ]);
  expect(mocks.sets[0]).toMatchObject({
    activeInviteTokenHash: null,
    activeInviteExpiresAt: null,
  });
  // Simulate a join that read the old invite before removal, then obtained the row lock afterward.
  await expect(joinGen2Workspace("old-invite", "target")).rejects.toMatchObject(
    { status: 404 },
  );
  expect(mocks.events).not.toContain("join-member");
});
it("locks and revalidates an active invitation before admitting a member", async () => {
  await joinGen2Workspace("active-invite", "target");
  expect(mocks.events.slice(0, 2)).toEqual(["lock-workspace", "join-member"]);
});

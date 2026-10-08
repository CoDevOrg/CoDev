import { beforeEach, expect, it, vi } from "vitest";
import type { Connection } from "./collaboration-connection";
const mocks = vi.hoisted(() => ({ member: vi.fn(), send: vi.fn() }));
vi.mock("./workspaces", () => ({ requireGen2Member: mocks.member }));
vi.mock("./collaboration-connection", () => ({ send: mocks.send }));
vi.mock("../platform/database-operation", () => ({
  withDatabaseOperation: (action: () => unknown) => action(),
}));
import { collaborationContext } from "./collaboration-context";
import { broadcastLocal, type LocalRoom } from "./collaboration-rooms";

beforeEach(() => vi.resetAllMocks());
it("excludes removed members from broadcasts and closes their existing socket", async () => {
  const close = vi.fn();
  const removed = {
    user: { id: "removed" },
    subscriptions: new Set(["a.ts"]),
    worktreeId: "main",
    socket: { close },
  } as unknown as Connection;
  const viewer = {
    user: { id: "viewer" },
    subscriptions: new Set(["a.ts"]),
    worktreeId: "main",
  } as Connection;
  const room = { connections: new Set([removed, viewer]) } as LocalRoom;
  mocks.member.mockImplementation(async (_workspace, user) => {
    if (user === "removed") throw new Error("Not a member");
    return { role: "viewer" };
  });
  await collaborationContext.run(
    { rooms: new Map([["gen2:workspace", room]]) },
    () =>
      broadcastLocal("gen2:workspace", {
        type: "update",
        worktreeId: "main",
        path: "a.ts",
        update: "AAA=",
        revision: "r1",
        actorId: "editor",
        streamId: "1-0",
      }),
  );
  expect(mocks.member).toHaveBeenCalledWith("workspace", "removed");
  expect(close).toHaveBeenCalledWith(1008, "Workspace access unavailable.");
  expect(room.connections.has(removed)).toBe(false);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.send.mock.calls[0]?.[0]).toBe(viewer);
});

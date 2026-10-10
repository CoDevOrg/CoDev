import { beforeEach, expect, it, vi } from "vitest";
import type { Connection } from "./collaboration-connection";
const mocks = vi.hoisted(() => ({ live: vi.fn(), send: vi.fn() }));
vi.mock("./collaboration-access", () => ({
  listGen2LiveMemberIds: mocks.live,
}));
vi.mock("./workspaces", () => ({ requireGen2Member: vi.fn() }));
vi.mock("./collaboration-connection", () => ({ sendSerialized: mocks.send }));
vi.mock("../platform/database-operation", () => ({
  withDatabaseOperation: (action: () => unknown) => action(),
}));
import { collaborationContext } from "./collaboration-context";
import { broadcastLocal, type LocalRoom } from "./collaboration-rooms";

function connection(id: string, close = vi.fn()) {
  return {
    user: { id },
    subscriptions: new Set(["a.ts"]),
    worktreeId: "main",
    socket: { close },
  } as unknown as Connection;
}

function inRoom(room: LocalRoom, action: () => Promise<void>) {
  return collaborationContext.run(
    { rooms: new Map([["gen2:workspace", room]]) },
    action,
  );
}

beforeEach(() => vi.resetAllMocks());

it("revalidates every recipient in one query and closes removed members", async () => {
  const close = vi.fn();
  const removed = connection("removed", close);
  const viewer = connection("viewer");
  const other = connection("other");
  const room = { connections: new Set([removed, viewer, other]) } as LocalRoom;
  mocks.live.mockResolvedValue(new Set(["viewer", "other"]));
  await inRoom(room, () =>
    broadcastLocal("gen2:workspace", {
      type: "update",
      worktreeId: "main",
      path: "a.ts",
      update: "AAA=",
      revision: "r1",
      actorId: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
      streamId: "1-0",
    }),
  );
  expect(mocks.live).toHaveBeenCalledTimes(1);
  expect(mocks.live).toHaveBeenCalledWith("workspace", [
    "removed",
    "viewer",
    "other",
  ]);
  expect(close).toHaveBeenCalledWith(1008, "Workspace access unavailable.");
  expect(room.connections.has(removed)).toBe(false);
  expect(mocks.send.mock.calls.map((call) => call[0])).toEqual([viewer, other]);
});

it("sends workspace events to every member regardless of open files", async () => {
  const reader = connection("reader");
  reader.subscriptions.clear();
  const room = { connections: new Set([reader]) } as LocalRoom;
  mocks.live.mockResolvedValue(new Set(["reader"]));
  await inRoom(room, () =>
    broadcastLocal("gen2:workspace", {
      type: "event",
      event: { kind: "worktrees.changed" },
      streamId: "2-0",
      at: "2026-07-28T12:00:00.000Z",
    }),
  );
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mocks.send.mock.calls[0]![1])).toMatchObject({
    type: "event",
  });
});

it("skips the membership query when nobody should receive the message", async () => {
  const room = { connections: new Set([connection("a")]) } as LocalRoom;
  await inRoom(room, () =>
    broadcastLocal("gen2:workspace", {
      type: "update",
      worktreeId: "main",
      path: "other.ts",
      update: "AAA=",
      revision: "r1",
      actorId: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
      streamId: "1-0",
    }),
  );
  expect(mocks.live).not.toHaveBeenCalled();
});

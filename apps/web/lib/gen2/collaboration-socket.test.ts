import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ServerWebSocket, WebSocketMessage } from "../platform/websocket";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  connections: new Set<{
    joined: boolean;
    worktreeId: string;
    subscriptions: Set<string>;
  }>(),
}));
vi.mock("./workspaces", () => ({ requireGen2Member: mocks.member }));
vi.mock("../platform/database-operation", () => ({
  withDatabaseOperation: (action: () => unknown) => action(),
}));
vi.mock("./collaboration-events", () => ({
  gen2CollaborationRoom: () => "room",
}));
vi.mock("./collaboration-documents", () => ({
  loadGen2Document: mocks.load,
  saveGen2Document: mocks.save,
  initializeGen2Document: vi.fn(),
  reconcileGen2Document: vi.fn(),
}));
vi.mock("./collaboration-redis", () => ({
  HEARTBEAT_INTERVAL_MS: 30000,
  MAX_SOCKET_PAYLOAD_BYTES: 131072,
  STREAM_MAX_LENGTH: 100,
  getInstanceId: () => "instance",
  streamKey: () => "stream",
  redisClient: vi.fn(),
  withDocumentLock: (
    _room: string,
    _tree: string,
    _path: string,
    action: () => unknown,
  ) => action(),
}));
vi.mock("./collaboration-rooms", () => ({
  startRoom: async () => ({ connections: mocks.connections }),
  broadcastLocal: vi.fn(),
  closeRoomIfEmpty: vi.fn(),
  publish: vi.fn(),
  replay: vi.fn(),
}));
vi.mock("./collaboration-presence", () => ({
  refreshPresence: vi.fn(),
  removePresence: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));
import { handleGen2CollaborationSocket } from "./collaboration-socket";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connections.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it.each(["viewer", "removed", "editor", "owner"])(
  "rechecks an existing editor socket when the current role is %s",
  async (role) => {
    let message!: (message: WebSocketMessage) => unknown;
    const send = vi.fn();
    const socket = {
      readyState: 1,
      openState: 1,
      send,
      onMessage: (callback: typeof message) => {
        message = callback;
      },
      onceClose: vi.fn(),
      onceError: vi.fn(),
      terminate: vi.fn(),
      close: vi.fn(),
    } as unknown as ServerWebSocket;
    await handleGen2CollaborationSocket(
      "workspace",
      socket,
      {
        id: "member",
        name: "Member",
        login: "member",
        avatarUrl: null,
      },
      { canEdit: true },
    );
    const connection = [...mocks.connections][0]!;
    connection.joined = true;
    connection.worktreeId = "main";
    connection.subscriptions.add("README.md");
    if (role === "removed")
      mocks.member.mockRejectedValue(new Error("Not a member"));
    else mocks.member.mockResolvedValue({ role });
    await message({
      data: JSON.stringify({
        type: "update",
        path: "README.md",
        update: "AAA=",
      }),
      isBinary: false,
    });
    expect(mocks.member).toHaveBeenCalledWith("workspace", "member");
    if (role === "viewer" || role === "removed") {
      expect(mocks.load).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalled();
      if (role === "viewer")
        expect(JSON.parse(send.mock.calls[0]![0])).toMatchObject({
          type: "error",
          code: "forbidden",
        });
    } else {
      expect(mocks.load).toHaveBeenCalled();
    }
  },
);

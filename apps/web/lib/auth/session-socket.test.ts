import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ServerWebSocket, WebSocketMessage } from "../platform/websocket";
import { sessionRevision } from "./session-revision";

const mocks = vi.hoisted(() => ({
  rows: [] as { passwordHash: string | null }[],
  lookup: vi.fn(),
}));
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        leftJoin: () => ({ where: () => ({ limit: mocks.lookup }) }),
      }),
    }),
  }),
}));
import { guardSessionSocket } from "./session-socket";

function fakeSocket() {
  let handler: ((message: WebSocketMessage) => void) | undefined;
  const closed: (() => void)[] = [];
  const socket = {
    readyState: 1,
    openState: 1,
    send: vi.fn(),
    terminate: vi.fn(),
    close: vi.fn(() => {
      socket.readyState = 3;
      closed.forEach((fn) => fn());
    }),
    onMessage: (fn: (message: WebSocketMessage) => void) => {
      handler = fn;
    },
    onceClose: (fn: () => void) => {
      closed.push(fn);
    },
    onceError: vi.fn(),
  } satisfies ServerWebSocket;
  return { socket, emit: () => handler?.({ data: "input", isBinary: false }) };
}
const user = { id: "u", credentialRevision: sessionRevision("old-hash") };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T00:00:00Z"));
  vi.clearAllMocks();
  mocks.rows = [{ passwordHash: "old-hash" }];
  mocks.lookup.mockImplementation(async () => mocks.rows);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
it("closes an already-open connection after a password reset, even without further input", async () => {
  const { socket, emit } = fakeSocket();
  const guarded = await guardSessionSocket(socket, user);
  const handler = vi.fn();
  guarded!.onMessage(handler);
  emit();
  await vi.advanceTimersByTimeAsync(0);
  expect(handler).toHaveBeenCalledOnce();
  mocks.rows = [{ passwordHash: "new-hash" }];
  await vi.advanceTimersByTimeAsync(15000);
  expect(socket.close).toHaveBeenCalledWith(
    1008,
    "Sign in again to reconnect.",
  );
  emit();
  await vi.advanceTimersByTimeAsync(0);
  expect(handler).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("rejects missing revisions and deleted accounts before connecting handlers", async () => {
  const { socket } = fakeSocket();
  expect(await guardSessionSocket(socket, { id: "u" })).toBeNull();
  mocks.rows = [];
  expect(await guardSessionSocket(fakeSocket().socket, user)).toBeNull();
});
it("fails closed when session storage becomes unavailable", async () => {
  const { socket } = fakeSocket();
  expect(await guardSessionSocket(socket, user)).not.toBeNull();
  mocks.lookup.mockRejectedValue(new Error("storage unavailable"));
  await vi.advanceTimersByTimeAsync(15000);
  expect(socket.close).toHaveBeenCalledOnce();
});
it("cleans up revalidation when the socket closes normally", async () => {
  const { socket } = fakeSocket();
  await guardSessionSocket(socket, user);
  socket.close();
  expect(vi.getTimerCount()).toBe(0);
});
it("buffers the browser's immediate join while validating the session", async () => {
  let resolve: (rows: { passwordHash: string }[]) => void = () => undefined;
  mocks.lookup.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { socket, emit } = fakeSocket();
  const connecting = guardSessionSocket(socket, user);
  emit();
  resolve([{ passwordHash: "old-hash" }]);
  const guarded = await connecting;
  const handler = vi.fn();
  guarded!.onMessage(handler);
  await vi.advanceTimersByTimeAsync(0);
  expect(handler).toHaveBeenCalledWith({ data: "input", isBinary: false });
});

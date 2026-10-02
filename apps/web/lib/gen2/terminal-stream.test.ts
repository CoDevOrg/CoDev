import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  input: vi.fn(),
  resize: vi.fn(),
  poll: vi.fn(),
  recheck: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./terminals", () => ({
  gen2TerminalBackend: () => ({
    input: (...args: unknown[]) => mocks.input(...args),
    resize: (...args: unknown[]) => mocks.resize(...args),
    poll: (...args: unknown[]) => mocks.poll(...args),
  }),
  recheckGen2TerminalMember: (...args: unknown[]) => mocks.recheck(...args),
}));

import {
  gen2TerminalStreamQuerySchema,
  handleGen2TerminalSocket,
} from "./terminal-stream";

class FakeSocket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];
  closed = false;

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this.emit("close");
  }
}

const target = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  userId: "user-1",
  sessionId: "term-1-1",
  worktreeId: "main",
  after: 4,
};

function open() {
  const socket = new FakeSocket();
  const done = handleGen2TerminalSocket(socket as never, target);
  return { socket, done };
}

describe("handleGen2TerminalSocket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.input.mockResolvedValue(undefined);
    mocks.resize.mockResolvedValue(undefined);
    mocks.recheck.mockResolvedValue(undefined);
  });

  it("pushes output from the cursor it was given, then the exit", async () => {
    mocks.poll
      .mockResolvedValueOnce({
        chunks: [
          { sequence: 4, data: "sh: nope: " },
          { sequence: 5, data: "not found\r\n" },
        ],
        nextSequence: 6,
        exited: false,
        exitCode: null,
      })
      .mockResolvedValueOnce({
        chunks: [],
        nextSequence: 6,
        exited: true,
        exitCode: 0,
      });

    const { socket, done } = open();
    await done;

    expect(mocks.poll.mock.calls).toEqual([
      ["term-1-1", 4],
      ["term-1-1", 6],
    ]);
    expect(socket.sent).toEqual([
      { type: "ready", after: 4 },
      { type: "data", data: "sh: nope: not found\r\n", next: 6 },
      { type: "exit", exitCode: 0, next: 6 },
    ]);
    expect(socket.closed).toBe(true);
  });

  it("forwards input in order and resizes without re-checking membership", async () => {
    let releasePoll!: () => void;
    mocks.poll.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePoll = () =>
            resolve({ chunks: [], nextSequence: 4, exited: true, exitCode: 0 });
        }),
    );
    const order: string[] = [];
    mocks.input.mockImplementation(async (_id: string, data: string) => {
      order.push(data);
    });

    const { socket, done } = open();
    const message = (value: object) =>
      socket.emit("message", Buffer.from(JSON.stringify(value)));
    message({ type: "input", data: "l" });
    message({ type: "input", data: "s" });
    message({ type: "resize", rows: 30, columns: 100 });
    await vi.waitFor(() => expect(mocks.resize).toHaveBeenCalled());
    await vi.waitFor(() => expect(order.join("")).toBe("ls"));
    expect(mocks.resize).toHaveBeenCalledWith("term-1-1", {
      type: "resize",
      rows: 30,
      columns: 100,
    });
    expect(mocks.recheck).not.toHaveBeenCalled();

    releasePoll();
    await done;
  });

  it("reports an upstream failure and closes without ending the shell", async () => {
    mocks.poll.mockRejectedValueOnce(new Error("sandbox stopped"));
    const { socket, done } = open();
    await done;
    expect(socket.sent.at(-1)).toEqual({
      type: "error",
      message: "sandbox stopped",
    });
    expect(socket.closed).toBe(true);
  });

  it("rejects malformed messages without dropping the stream", async () => {
    let releasePoll!: () => void;
    mocks.poll.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePoll = () =>
            resolve({ chunks: [], nextSequence: 4, exited: true, exitCode: 0 });
        }),
    );
    const { socket, done } = open();
    socket.emit("message", Buffer.from("not json"));
    expect(socket.sent).toContainEqual({
      type: "error",
      message: "Invalid terminal message.",
    });
    expect(mocks.input).not.toHaveBeenCalled();
    releasePoll();
    await done;
  });
});

describe("gen2TerminalStreamQuerySchema", () => {
  it("defaults the worktree and cursor and rejects a forged session id", () => {
    expect(
      gen2TerminalStreamQuerySchema.parse({ sessionId: "term-1-1" }),
    ).toEqual({ sessionId: "term-1-1", worktreeId: "main", after: 0 });
    expect(
      gen2TerminalStreamQuerySchema.safeParse({ sessionId: "../etc" }).success,
    ).toBe(false);
  });
});

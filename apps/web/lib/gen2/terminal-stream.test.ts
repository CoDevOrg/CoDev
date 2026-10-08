import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ServerWebSocket, WebSocketMessage } from "../platform/websocket";

const mocks = vi.hoisted(() => ({
  input: vi.fn(),
  resize: vi.fn(),
  poll: vi.fn(),
  access: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./terminals", () => ({
  gen2TerminalBackend: () => ({
    input: (...args: unknown[]) => mocks.input(...args),
    resize: (...args: unknown[]) => mocks.resize(...args),
    poll: (...args: unknown[]) => mocks.poll(...args),
  }),
}));
vi.mock("./terminal-access", () => ({
  gen2TerminalAccess: (...args: unknown[]) => mocks.access(...args),
}));

import {
  gen2TerminalStreamQuerySchema,
  handleGen2TerminalSocket,
} from "./terminal-stream";

class FakeSocket implements ServerWebSocket {
  openState = 1;
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];
  closed = false;
  private messageListeners: Array<(message: WebSocketMessage) => void> = [];
  private closeListeners: Array<() => void> = [];
  private errorListeners: Array<() => void> = [];

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this.closeListeners.splice(0).forEach((listener) => listener());
  }

  terminate() {
    this.close();
  }

  onMessage(listener: (message: WebSocketMessage) => void) {
    this.messageListeners.push(listener);
  }

  onceClose(listener: () => void) {
    this.closeListeners.push(listener);
  }

  onceError(listener: () => void) {
    this.errorListeners.push(listener);
  }

  emitMessage(data: string, isBinary = false) {
    this.messageListeners.forEach((listener) =>
      listener({ data: isBinary ? null : data, isBinary }),
    );
  }

  emitError() {
    this.errorListeners.splice(0).forEach((listener) => listener());
  }
}

const access = {
  provider: "azure_arm",
  status: "ready",
  generation: 2,
  host: "codev-a-g2.trycodev.com",
};

const target = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  userId: "user-1",
  sessionId: "term-1-1",
  worktreeId: "main",
  after: 4,
};

function open() {
  const socket = new FakeSocket();
  const done = handleGen2TerminalSocket(socket, target);
  return { socket, done };
}

describe("handleGen2TerminalSocket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.input.mockResolvedValue(undefined);
    mocks.resize.mockResolvedValue(undefined);
    mocks.access.mockResolvedValue(access);
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
      ["term-1-1", 4, access],
      ["term-1-1", 6, access],
    ]);
    // One live check opens the stream, then one per poll before delivery.
    expect(mocks.access).toHaveBeenCalledTimes(3);
    expect(socket.sent).toEqual([
      { type: "ready", after: 4 },
      { type: "data", data: "sh: nope: not found\r\n", next: 6 },
      { type: "exit", exitCode: 0, next: 6 },
    ]);
    expect(socket.closed).toBe(true);
  });

  it("forwards input in order and checks access once per batch", async () => {
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
      socket.emitMessage(JSON.stringify(value));
    message({ type: "input", data: "l" });
    message({ type: "input", data: "s" });
    message({ type: "resize", rows: 30, columns: 100 });
    await vi.waitFor(() => expect(mocks.resize).toHaveBeenCalled());
    await vi.waitFor(() => expect(order.join("")).toBe("ls"));
    expect(mocks.resize).toHaveBeenCalledWith(
      "term-1-1",
      { type: "resize", rows: 30, columns: 100 },
      access,
    );
    expect(mocks.input.mock.calls.every((call) => call[2] === access)).toBe(
      true,
    );

    await vi.waitFor(() => expect(releasePoll).toBeTypeOf("function"));
    releasePoll();
    await done;
  });

  it.each(["input", "resize"])(
    "blocks %s immediately after membership is revoked",
    async (type) => {
      let releasePoll!: () => void;
      mocks.poll.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releasePoll = () =>
              resolve({
                chunks: [],
                nextSequence: 4,
                exited: true,
                exitCode: 0,
              });
          }),
      );
      const { socket, done } = open();
      await vi.waitFor(() => expect(releasePoll).toBeTypeOf("function"));
      mocks.access.mockRejectedValue(new Error("Edit permission required"));
      socket.emitMessage(
        JSON.stringify(
          type === "input"
            ? { type, data: "rm -rf files" }
            : { type, rows: 24, columns: 80 },
        ),
      );
      await vi.waitFor(() => expect(socket.closed).toBe(true));
      expect(mocks.input).not.toHaveBeenCalled();
      expect(mocks.resize).not.toHaveBeenCalled();
      releasePoll();
      await done;
    },
  );

  it("does not deliver output fetched while membership was revoked", async () => {
    mocks.poll.mockImplementationOnce(async () => {
      mocks.access.mockRejectedValue(new Error("No longer a member"));
      return {
        chunks: [{ sequence: 4, data: "private output" }],
        nextSequence: 5,
        exited: false,
        exitCode: null,
      };
    });
    const { socket, done } = open();
    await done;
    expect(socket.sent.some((message) => message.type === "data")).toBe(false);
    expect(socket.closed).toBe(true);
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
    socket.emitMessage("not json");
    expect(socket.sent).toContainEqual({
      type: "error",
      message: "Invalid terminal message.",
    });
    expect(mocks.input).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(releasePoll).toBeTypeOf("function"));
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

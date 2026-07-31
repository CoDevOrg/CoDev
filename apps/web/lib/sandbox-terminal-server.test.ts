import { afterEach, describe, expect, it, vi } from "vitest";

const orchestrator = vi.hoisted(() => ({
  closeSandboxTerminal: vi.fn(),
  pollSandboxTerminal: vi.fn(),
  resizeSandboxTerminal: vi.fn(),
  sendSandboxTerminalInput: vi.fn(),
  startSandboxTerminal: vi.fn(),
}));
const workspaceState = vi.hoisted(() => ({
  appendWorkspaceStateEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/orchestrator", () => orchestrator);
vi.mock("@/lib/workspace-state", () => workspaceState);

import type { WebSocket } from "ws";

import {
  handleSandboxTerminalSocket,
  type SandboxTerminalActor,
} from "./sandbox-terminal-server";

class FakeSocket {
  readonly OPEN = 1;
  readonly sent: string[] = [];
  readyState = this.OPEN;
  private readonly listeners = new Map<string, ((value?: unknown) => void)[]>();

  on(event: string, listener: (value?: unknown) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  once(event: string, listener: (value?: unknown) => void) {
    const wrapped = (value?: unknown) => {
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter(
          (candidate) => candidate !== wrapped,
        ),
      );
      listener(value);
    };
    return this.on(event, wrapped);
  }

  send(value: string) {
    this.sent.push(value);
  }

  emit(event: string, value?: unknown) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(value);
    }
  }
}

function eventually(predicate: () => boolean, timeoutMs = 1_000) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for terminal bridge output."));
      }
    }, 5);
  });
}

const actor: SandboxTerminalActor = {
  userId: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
  userName: "Ada",
  avatarUrl: null,
};

describe("sandbox terminal WebSocket bridge", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("forwards PTY lifecycle and output between the browser socket and orchestrator", async () => {
    orchestrator.closeSandboxTerminal.mockResolvedValue(undefined);
    orchestrator.startSandboxTerminal.mockResolvedValue("term-1");
    orchestrator.pollSandboxTerminal
      .mockResolvedValueOnce({
        chunks: [{ sequence: 1, data: "codev-terminal-ok\n" }],
        nextSequence: 2,
        exited: false,
        exitCode: null,
      })
      .mockResolvedValueOnce({
        chunks: [],
        nextSequence: 2,
        exited: true,
        exitCode: 0,
      });

    const socket = new FakeSocket();
    await handleSandboxTerminalSocket(
      "e010bd2c-a3c1-438f-acef-166287a3b1cb",
      socket as unknown as WebSocket,
      actor,
    );
    socket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "start", rows: 24, columns: 80 })),
    );

    await eventually(() => socket.sent.length >= 3);
    const messages = socket.sent.map((value) => JSON.parse(value));
    expect(messages[0]).toMatchObject({
      type: "ready",
      sessionId: "term-1",
      event: { type: "TERMINAL_EXEC_START", actor: { userName: "Ada" } },
    });
    expect(messages).toContainEqual({
      type: "data",
      data: "codev-terminal-ok\n",
    });
    expect(messages.at(-1)).toMatchObject({
      type: "exit",
      exitCode: 0,
      event: { type: "TERMINAL_EXEC_END", payload: { status: "completed" } },
    });

    socket.emit("message", JSON.stringify({ type: "input", data: "ls\n" }));
    socket.emit(
      "message",
      JSON.stringify({ type: "resize", rows: 40, columns: 120 }),
    );
    await eventually(
      () =>
        orchestrator.sendSandboxTerminalInput.mock.calls.length === 1 &&
        orchestrator.resizeSandboxTerminal.mock.calls.length === 1,
    );
    expect(orchestrator.sendSandboxTerminalInput).toHaveBeenCalledWith(
      "e010bd2c-a3c1-438f-acef-166287a3b1cb",
      "term-1",
      "ls\n",
    );
    expect(orchestrator.resizeSandboxTerminal).toHaveBeenCalledWith(
      "e010bd2c-a3c1-438f-acef-166287a3b1cb",
      "term-1",
      { type: "resize", rows: 40, columns: 120 },
    );

    socket.emit("close");
    await eventually(
      () => orchestrator.closeSandboxTerminal.mock.calls.length === 1,
    );
  });

  it("keeps reviewer terminal sockets read-only", async () => {
    orchestrator.startSandboxTerminal.mockResolvedValue("term-review");
    orchestrator.pollSandboxTerminal.mockResolvedValue({
      chunks: [{ sequence: 1, data: "review-output\n" }],
      nextSequence: 2,
      exited: true,
      exitCode: 0,
    });

    const socket = new FakeSocket();
    await handleSandboxTerminalSocket(
      "e010bd2c-a3c1-438f-acef-166287a3b1cb",
      socket as unknown as WebSocket,
      { ...actor, readOnly: true },
    );
    socket.emit(
      "message",
      JSON.stringify({ type: "start", rows: 24, columns: 80 }),
    );
    await eventually(() =>
      socket.sent.some((value) => JSON.parse(value).type === "data"),
    );

    socket.emit(
      "message",
      JSON.stringify({ type: "input", data: "rm -rf /\n" }),
    );
    socket.emit(
      "message",
      JSON.stringify({ type: "resize", rows: 40, columns: 120 }),
    );
    await eventually(() =>
      socket.sent.some(
        (value) =>
          JSON.parse(value).message ===
          "This terminal is read-only for your workspace role.",
      ),
    );

    expect(orchestrator.sendSandboxTerminalInput).not.toHaveBeenCalled();
    expect(orchestrator.resizeSandboxTerminal).not.toHaveBeenCalled();
  });
});

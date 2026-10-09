import { afterEach, describe, expect, it, vi } from "vitest";

import { attachTerminalTransport } from "./terminal-transport";

/** Accepts the upgrade, then closes before the stream says it is ready. */
class DroppedSocket {
  static OPEN = 1;
  static opened = 0;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    DroppedSocket.opened += 1;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
      this.readyState = 3;
      this.onclose?.();
    }, 0);
  }
  send() {}
  close() {}
}

describe("attachTerminalTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    DroppedSocket.opened = 0;
  });

  it("polls over HTTP when sockets open but never become ready", async () => {
    vi.stubGlobal("WebSocket", DroppedSocket);
    const post = vi.fn(async (body: Record<string, unknown>) =>
      body.action === "poll"
        ? Response.json({ chunks: [], nextSequence: 0, exited: true })
        : new Response(null, { status: 204 }),
    );
    const onExit = vi.fn();
    const transport = attachTerminalTransport({
      workspaceId: "workspace-1",
      worktreeId: "main",
      sessionId: "session-1",
      after: 0,
      post,
      onChunk: vi.fn(),
      onCursor: vi.fn(),
      onExit,
      onPaused: vi.fn(),
    });

    await vi.waitFor(() => expect(onExit).toHaveBeenCalled());
    expect(DroppedSocket.opened).toBe(1);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ action: "poll" }),
    );
    transport.stop();
  });
});

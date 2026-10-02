import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { useGen2SharedFileDocument } from "./use-gen2-shared-file-document";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = WebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }
}

describe("useGen2SharedFileDocument", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  it("does not show an alarming disconnected notice when connection fails on initial open", () => {
    const { result } = renderHook(() =>
      useGen2SharedFileDocument({
        workspaceId: "ws-1",
        worktreeId: "main",
        path: "index.ts",
        canEdit: true,
        onContentsChange: vi.fn(),
      }),
    );

    const socket = MockWebSocket.instances[0];
    expect(socket).toBeDefined();

    // Socket fails to establish on initial attempt
    act(() => {
      socket.close();
    });

    // Notice should remain null — not showing "Collaboration disconnected. Reconnecting…"
    expect(result.current.notice).toBeNull();
    expect(result.current.state).toBe("disconnected");
  });

  it("shows reconnecting notice only if session was previously synced", () => {
    const { result } = renderHook(() =>
      useGen2SharedFileDocument({
        workspaceId: "ws-1",
        worktreeId: "main",
        path: "index.ts",
        canEdit: true,
        onContentsChange: vi.fn(),
      }),
    );

    const socket = MockWebSocket.instances[0];
    expect(socket).toBeDefined();

    const validUpdate = Buffer.from(
      Y.encodeStateAsUpdate(new Y.Doc()),
    ).toString("base64");

    // Simulate successful sync
    act(() => {
      socket.readyState = WebSocket.OPEN;
      socket.onmessage?.({
        data: JSON.stringify({
          type: "sync",
          path: "index.ts",
          update: validUpdate,
          stateVector: validUpdate,
          revision: "rev-1",
        }),
      });
    });

    expect(result.current.state).toBe("connected");
    expect(result.current.notice).toBeNull();

    // Now disconnect
    act(() => {
      socket.close();
    });

    expect(result.current.state).toBe("disconnected");
    expect(result.current.notice).toBe(
      "Collaboration disconnected. Reconnecting…",
    );
  });
});

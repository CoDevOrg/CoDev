import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { useGen2SharedFileDocument } from "./use-gen2-shared-file-document";
import { WorkspaceRealtimeProvider } from "./workspace-realtime-provider";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState: number = WebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: Array<Record<string, unknown>> = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }

  receive(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  welcome() {
    this.readyState = WebSocket.OPEN;
    this.receive({
      type: "welcome",
      connectionId: "c1",
      user: {
        id: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
        login: "octo",
        name: null,
        avatarUrl: null,
      },
      heartbeatIntervalMs: 20_000,
      streamId: "0-0",
    });
  }
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <WorkspaceRealtimeProvider
    workspaceId="ws-1"
    currentUserId="e010bd2c-a3c1-438f-acef-166287a3b1cb"
    initialMembers={[]}
  >
    {children}
  </WorkspaceRealtimeProvider>
);

const emptyUpdate = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString(
  "base64",
);

function renderDocument(path: string | null = "index.ts") {
  return renderHook(
    (props: { path: string | null }) =>
      useGen2SharedFileDocument({
        workspaceId: "ws-1",
        worktreeId: "main",
        path: props.path,
        canEdit: true,
        onContentsChange: vi.fn(),
      }),
    { wrapper, initialProps: { path } },
  );
}

describe("useGen2SharedFileDocument", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  it("stays quietly connecting when the socket never opens", () => {
    const { result } = renderDocument();
    act(() => MockWebSocket.instances[0]!.close());
    expect(result.current.notice).toBeNull();
    expect(result.current.state).toBe("connecting");
  });

  it("subscribes over the workspace socket and reconnects with a notice", () => {
    const { result } = renderDocument();
    const socket = MockWebSocket.instances[0]!;
    act(() => socket.welcome());
    expect(socket.sent).toContainEqual(
      expect.objectContaining({
        type: "subscribe",
        worktreeId: "main",
        path: "index.ts",
      }),
    );
    act(() =>
      socket.receive({
        type: "sync",
        path: "index.ts",
        update: emptyUpdate,
        stateVector: emptyUpdate,
        revision: "rev-1",
      }),
    );
    expect(result.current.state).toBe("connected");
    expect(result.current.notice).toBeNull();

    act(() => socket.close());
    expect(result.current.state).toBe("disconnected");
    expect(result.current.notice).toBe(
      "Collaboration disconnected. Reconnecting…",
    );
  });

  it("switches files on one socket instead of opening another", () => {
    const { rerender } = renderDocument();
    const socket = MockWebSocket.instances[0]!;
    act(() => socket.welcome());
    act(() => rerender({ path: "other.ts" }));
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(socket.sent).toContainEqual({
      type: "unsubscribe",
      worktreeId: "main",
      path: "index.ts",
    });
    expect(socket.sent.at(-1)).toMatchObject({
      type: "subscribe",
      path: "other.ts",
    });
  });

  it("sends edits made while disconnected after the resync", () => {
    vi.useFakeTimers();
    const { result } = renderDocument();
    const socket = MockWebSocket.instances[0]!;
    act(() => socket.welcome());
    act(() =>
      socket.receive({
        type: "sync",
        path: "index.ts",
        update: emptyUpdate,
        stateVector: emptyUpdate,
        revision: "rev-1",
      }),
    );
    act(() => socket.close());
    result.current.text!.insert(0, "offline edit");

    act(() => vi.runOnlyPendingTimers());
    const next = MockWebSocket.instances.at(-1)!;
    act(() => next.welcome());
    act(() =>
      next.receive({
        type: "sync",
        path: "index.ts",
        update: emptyUpdate,
        stateVector: emptyUpdate,
        revision: "rev-1",
      }),
    );
    expect(next.sent).toContainEqual(
      expect.objectContaining({ type: "update", path: "index.ts" }),
    );
    vi.useRealTimers();
  });
});

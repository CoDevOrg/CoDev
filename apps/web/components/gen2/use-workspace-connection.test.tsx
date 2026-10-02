import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useWorkspaceConnection,
  CONNECTION_CHECK_MS,
  CONNECTION_TIMEOUT_MS,
} from "./use-workspace-connection";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("@/lib/gen2/startup-client", () => ({
  ensureGen2WorkspaceReady: mocks.connect,
}));
const connected = () => Promise.resolve(Response.json({ connected: true }));

describe("workspace connection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T18:00:00Z"));
    vi.stubGlobal("fetch", vi.fn(connected));
    mocks.connect.mockReset();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  async function flush() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("checks once when opened in a background tab", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    const { result } = renderHook(() =>
      useWorkspaceConnection("w", true, vi.fn()),
    );
    await flush();
    expect(result.current.state).toBe("connected");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECTION_CHECK_MS);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a hung connection check offers reconnect after ten seconds", async () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() =>
      useWorkspaceConnection("w", true, vi.fn()),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECTION_TIMEOUT_MS);
    });
    expect(result.current.state).toBe("disconnected");
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("an older status response cannot undo a successful reconnect", async () => {
    let finishCheck!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCheck = resolve;
        }),
    );
    mocks.connect.mockResolvedValue({
      workspace: { id: "w", status: "ready" },
    });
    const { result } = renderHook(() =>
      useWorkspaceConnection("w", true, vi.fn()),
    );
    await act(async () => {
      await result.current.reconnect();
    });
    expect(result.current.state).toBe("connected");
    await act(async () => {
      finishCheck(Response.json({ connected: false }));
    });
    expect(result.current.state).toBe("connected");
  });

  it("checks without waking; only recent user activity sends a keepalive", async () => {
    const { result } = renderHook(() =>
      useWorkspaceConnection("w", true, vi.fn()),
    );
    await flush();
    expect(result.current.state).toBe("connected");
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.method).toBe("GET");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECTION_CHECK_MS);
    });
    expect(vi.mocked(fetch).mock.lastCall?.[1]?.method).toBe("POST");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * CONNECTION_CHECK_MS);
    });
    expect(vi.mocked(fetch).mock.lastCall?.[1]?.method).toBe("GET");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECTION_CHECK_MS);
    });
    expect(vi.mocked(fetch).mock.lastCall?.[1]?.method).toBe("POST");
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("a sleeping workspace stays disconnected until one explicit reconnect", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ connected: false }));
    let finish!: (value: unknown) => void;
    mocks.connect.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onConnected = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceConnection("w", true, onConnected),
    );
    await flush();
    expect(result.current.state).toBe("disconnected");
    expect(mocks.connect).not.toHaveBeenCalled();
    let first!: Promise<boolean>, second!: Promise<boolean>;
    act(() => {
      first = result.current.reconnect();
      second = result.current.reconnect();
    });
    expect(first).toBe(second);
    expect(result.current.state).toBe("connecting");
    await act(async () => {
      finish({ workspace: { id: "w", status: "ready" } });
      await first;
    });
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe("connected");
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable failure and does not touch while hidden", async () => {
    mocks.connect.mockResolvedValue({
      error: "Couldn't reconnect. Please try again.",
    });
    const { result } = renderHook(() =>
      useWorkspaceConnection("w", true, vi.fn()),
    );
    await flush();
    await act(async () => {
      await result.current.reconnect();
    });
    expect(result.current.state).toBe("disconnected");
    expect(result.current.error).toContain("try again");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    vi.mocked(fetch).mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * CONNECTION_CHECK_MS);
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Gen2HomeSnapshot, Gen2Workspace } from "@codev/contracts";

import { useGen2HomeSnapshot } from "./use-gen2-home-snapshot";

function workspace(status: Gen2Workspace["status"]): Gen2Workspace {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Studio",
    repository: null,
    status,
    sandboxId: null,
    runtimeProvider: "azure_arm",
    runtimeStatus: status === "ready" ? "ready" : "booting",
    runtimeGeneration: 1,
    lastError: null,
    role: "owner",
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
  };
}

function snapshot(workspaces: Gen2Workspace[], minutesUsed = 0) {
  return {
    workspaces,
    compute: {
      minutesUsed,
      minutesLimit: 600,
      unlimited: false,
      resetsAt: null,
      tier: "free",
      freeEnabled: true,
      ownedWorkspaceCount: workspaces.length,
      workspaceLimit: 2,
      activeWorkspaceLimit: 1,
      armBootMinutesCount: true,
      budget: null,
    },
  } satisfies Gen2HomeSnapshot;
}

const idle = snapshot([workspace("ready")]);
const starting = snapshot([workspace("provisioning")]);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

let visibility: DocumentVisibilityState = "visible";
const fetchMock = vi.fn<typeof fetch>();
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("useGen2HomeSnapshot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("refreshes the dedicated endpoint every 30 seconds when idle", async () => {
    const next = snapshot([workspace("ready")], 42);
    fetchMock.mockImplementation(async () => json(next));
    const { result } = renderHook(() => useGen2HomeSnapshot(idle));

    await advance(29_000);
    expect(fetchMock).not.toHaveBeenCalled();
    await advance(1_000);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gen2/home",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(result.current.snapshot.compute.minutesUsed).toBe(42);
  });

  it("refreshes every 4 seconds while a workspace is starting", async () => {
    fetchMock.mockImplementation(async () => json(starting));
    renderHook(() => useGen2HomeSnapshot(starting));

    await advance(4_000);
    await advance(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips hidden tabs and catches up when the tab is shown", async () => {
    fetchMock.mockImplementation(async () => json(idle));
    renderHook(() => useGen2HomeSnapshot(idle));

    visibility = "hidden";
    await advance(60_000);
    expect(fetchMock).not.toHaveBeenCalled();

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a local update when an older poll answers afterwards", async () => {
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => (answer = resolve)),
    );
    const { result } = renderHook(() => useGen2HomeSnapshot(idle));

    await advance(30_000);
    act(() =>
      result.current.update((current) => ({ ...current, workspaces: [] })),
    );
    await act(async () => answer(json(idle)));
    expect(result.current.snapshot.workspaces).toEqual([]);
  });

  it("stops polling once the session has ended", async () => {
    fetchMock.mockImplementation(async () => json({}, 401));
    const { result } = renderHook(() => useGen2HomeSnapshot(idle));

    await advance(30_000);
    await advance(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.snapshot).toBe(idle);
  });
});

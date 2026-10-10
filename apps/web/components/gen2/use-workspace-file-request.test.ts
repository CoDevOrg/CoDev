import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceFileRequest } from "./use-workspace-file-request";

describe("useWorkspaceFileRequest", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("issues a request again while the pane is busy, and never after a decline", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceFileRequest());
    act(() => result.current.open("src/a.ts", { line: 3 }));
    expect(result.current.path).toBe("src/a.ts");
    expect(result.current.range).toMatchObject({ path: "src/a.ts", line: 3 });

    act(() => result.current.consumed("busy"));
    expect(result.current.path).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.path).toBe("src/a.ts");

    act(() => result.current.consumed("declined"));
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.path).toBeNull();
    expect(result.current.range).toBeNull();
  });

  it("keeps the range for the pane once the file opened", () => {
    const { result } = renderHook(() => useWorkspaceFileRequest());
    act(() => result.current.open("src/a.ts", { line: 3, endLine: 5 }));
    act(() => result.current.consumed("opened"));
    expect(result.current.path).toBeNull();
    expect(result.current.range).toMatchObject({ line: 3, endLine: 5 });
    act(() => result.current.open("src/b.ts"));
    expect(result.current.range).toBeNull();
  });
});

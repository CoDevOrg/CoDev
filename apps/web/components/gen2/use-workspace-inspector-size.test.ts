import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const panel = vi.hoisted(() => ({
  getSize: () => ({ asPercentage: 30, inPixels: 400 }),
  resize: vi.fn(),
}));

vi.mock("react-resizable-panels", () => ({
  usePanelRef: () => ({ current: panel }),
}));

import { useWorkspaceInspectorSize } from "./use-workspace-inspector-size";

describe("useWorkspaceInspectorSize", () => {
  it("gives a preview room and keeps the chat usable", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useWorkspaceInspectorSize(active),
      { initialProps: { active: false } },
    );
    expect(result.current).toMatchObject({
      maxSize: "480px",
      centerMinSize: "240px",
    });
    rerender({ active: true });
    expect(result.current).toMatchObject({
      maxSize: "75%",
      centerMinSize: "420px",
    });
  });

  it("expands to 65%, restores the member's width, and re-expands on return", () => {
    panel.resize.mockClear();
    const { result, rerender } = renderHook(
      ({ active }) => useWorkspaceInspectorSize(active),
      { initialProps: { active: true } },
    );
    act(() => result.current.onExpandChange(true));
    expect(panel.resize).toHaveBeenLastCalledWith("65%");
    act(() => result.current.onExpandChange(false));
    expect(panel.resize).toHaveBeenLastCalledWith(400);

    act(() => result.current.onExpandChange(true));
    rerender({ active: false });
    expect(panel.resize).toHaveBeenLastCalledWith(400);
    rerender({ active: true });
    expect(panel.resize).toHaveBeenLastCalledWith("65%");
    expect(panel.resize).toHaveBeenCalledTimes(5);
  });
});

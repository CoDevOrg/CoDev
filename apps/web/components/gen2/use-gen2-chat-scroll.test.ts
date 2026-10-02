import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useGen2ChatScroll } from "./use-gen2-chat-scroll";

function fakeScroller(startTop: number) {
  let scrollTop = startTop;
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { get: () => 1000 });
  Object.defineProperty(el, "clientHeight", { get: () => 400 });
  Object.defineProperty(el, "scrollTop", {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  return el;
}

describe("useGen2ChatScroll", () => {
  it("follows new content while pinned and yields after the user scrolls up", () => {
    const el = fakeScroller(600);
    const ref = { current: el };
    const { result, rerender } = renderHook(
      ({ key }: { key: number }) => useGen2ChatScroll(ref, key),
      { initialProps: { key: 1 } },
    );

    expect(el.scrollTop).toBe(1000);

    el.scrollTop = 10;
    act(() => {
      result.current.onScroll();
    });
    expect(result.current.showJump).toBe(true);

    rerender({ key: 2 });
    expect(el.scrollTop).toBe(10);

    act(() => {
      result.current.jumpToLatest();
    });
    expect(el.scrollTop).toBe(1000);
    expect(result.current.showJump).toBe(false);
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScrambleText } from "./use-scramble-text";

const first = "http://localhost:3000/join/abc123";
const second = "http://localhost:3000/join/xyz789";

function stubMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("reduce"),
    })),
  );
}

describe("useScrambleText", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the first value immediately", () => {
    const { result } = renderHook(({ text }) => useScrambleText(text), {
      initialProps: { text: "" },
    });
    expect(result.current).toBe("");
  });

  it("does not animate the first link that arrives", () => {
    const { result, rerender } = renderHook(
      ({ text }) => useScrambleText(text),
      { initialProps: { text: "" } },
    );
    rerender({ text: first });
    expect(result.current).toBe(first);
  });

  it("scrambles a changed value, keeps its separators, then reveals it", () => {
    const { result, rerender } = renderHook(
      ({ text }) => useScrambleText(text),
      { initialProps: { text: first } },
    );
    rerender({ text: second });
    expect(result.current).not.toBe(second);
    expect(result.current).toHaveLength(second.length);
    expect(result.current.startsWith("://", 4)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(32 * 60);
    });
    expect(result.current).toBe(second);
  });

  it("skips the animation when the user prefers reduced motion", () => {
    stubMotion(true);
    const { result, rerender } = renderHook(
      ({ text }) => useScrambleText(text),
      { initialProps: { text: first } },
    );
    rerender({ text: second });
    expect(result.current).toBe(second);
  });
});

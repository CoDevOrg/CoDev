import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Gen2ChatGoal } from "@codev/contracts";

import { MAX_GOAL_TURNS, useGoalContinuation } from "./use-goal-continuation";

const active: Gen2ChatGoal = {
  text: "Ship it",
  status: "active",
  summary: null,
};
const done = { chatId: "chat-1", status: "completed" } as const;

function setup(
  initial: { goal?: Gen2ChatGoal | null; connected?: boolean } = {},
) {
  const onContinue = vi.fn();
  const hook = renderHook(
    ({ goal, chatId, connected }) =>
      useGoalContinuation({ goal, chatId, connected, onContinue }),
    {
      initialProps: {
        goal: initial.goal === undefined ? active : initial.goal,
        chatId: "chat-1" as string | null,
        connected: initial.connected ?? true,
      },
    },
  );
  return { ...hook, onContinue };
}

describe("useGoalContinuation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays off until the member opts in", () => {
    const { result, onContinue } = setup();
    act(() => result.current.onSettled(done));
    expect(result.current.countdown).toBeNull();
    act(() => vi.advanceTimersByTime(10_000));
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("counts down five seconds, then continues and counts the turn", () => {
    const { result, onContinue } = setup();
    act(() => result.current.setEnabled(true));
    act(() => result.current.onSettled(done));
    expect(result.current.countdown).toBe(5);
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.countdown).toBe(4);
    act(() => vi.advanceTimersByTime(4_000));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(result.current.countdown).toBeNull();
    expect(result.current.turns).toBe(1);
  });

  it("never arms after a failed or stopped turn, or another chat's", () => {
    const { result } = setup();
    act(() => result.current.setEnabled(true));
    act(() => result.current.onSettled({ ...done, status: "failed" }));
    act(() => result.current.onSettled({ ...done, status: "stopped" }));
    act(() => result.current.onSettled({ ...done, chatId: "chat-2" }));
    expect(result.current.countdown).toBeNull();
  });

  it("stops after the turn limit", () => {
    const { result, onContinue } = setup();
    act(() => result.current.setEnabled(true));
    for (let turn = 0; turn < MAX_GOAL_TURNS + 1; turn += 1) {
      act(() => result.current.onSettled(done));
      act(() => vi.advanceTimersByTime(5_000));
    }
    expect(onContinue).toHaveBeenCalledTimes(MAX_GOAL_TURNS);
    expect(result.current.turns).toBe(MAX_GOAL_TURNS);
  });

  it("cancels on Stop, achievement, disconnect, a hidden tab and a chat switch", () => {
    const { result, rerender, onContinue } = setup();
    const arm = () => {
      act(() => result.current.setEnabled(true));
      act(() => result.current.onSettled(done));
      expect(result.current.countdown).toBe(5);
    };
    arm();
    act(() => result.current.stop());
    expect(result.current.enabled).toBe(false);

    arm();
    rerender({
      goal: { ...active, status: "achieved" },
      chatId: "chat-1",
      connected: true,
    });
    expect(result.current.countdown).toBeNull();

    rerender({ goal: active, chatId: "chat-1", connected: true });
    arm();
    rerender({ goal: active, chatId: "chat-1", connected: false });
    expect(result.current.countdown).toBeNull();

    rerender({ goal: active, chatId: "chat-1", connected: true });
    arm();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.countdown).toBeNull();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    arm();
    rerender({ goal: active, chatId: "chat-2", connected: true });
    expect(result.current.countdown).toBeNull();
    expect(result.current.enabled).toBe(false);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onContinue).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Gen2ChatGoal } from "@codev/contracts";

import { ChatGoalBar } from "./chat-goal-bar";
import type { GoalContinuation } from "./use-goal-continuation";

const goal: Gen2ChatGoal = {
  text: "Ship the login page",
  status: "active",
  summary: null,
};

function continuation(overrides: Partial<GoalContinuation> = {}) {
  return {
    enabled: false,
    setEnabled: vi.fn(),
    countdown: null,
    turns: 0,
    stop: vi.fn(),
    onSettled: vi.fn(),
    ...overrides,
  } satisfies GoalContinuation;
}

describe("ChatGoalBar", () => {
  it("sends Continue, Mark done and Clear as plain turns", () => {
    const onSend = vi.fn();
    render(
      <ChatGoalBar
        goal={goal}
        canEdit
        busy={false}
        continuation={continuation()}
        onSend={onSend}
      />,
    );
    expect(screen.getByRole("region", { name: "Chat goal" })).toHaveTextContent(
      "Ship the login pageActive",
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onSend.mock.calls).toEqual([
      ["Continue working toward the goal."],
      ["/goal done"],
      ["/goal clear"],
    ]);
  });

  it("offers Keep going as an opt-in switch with its turn count", () => {
    const setEnabled = vi.fn();
    const { rerender } = render(
      <ChatGoalBar
        goal={goal}
        canEdit
        busy={false}
        continuation={continuation({ setEnabled })}
        onSend={vi.fn()}
      />,
    );
    const toggle = screen.getByRole("switch", { name: "Keep going" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(setEnabled).toHaveBeenCalledWith(true);
    rerender(
      <ChatGoalBar
        goal={goal}
        canEdit
        busy={false}
        continuation={continuation({ enabled: true, turns: 3 })}
        onSend={vi.fn()}
      />,
    );
    expect(screen.getByText("Turn 3 of 5")).toBeInTheDocument();
  });

  it("shows the countdown with a Stop in place of the actions", () => {
    const stop = vi.fn();
    render(
      <ChatGoalBar
        goal={goal}
        canEdit
        busy={false}
        continuation={continuation({ enabled: true, countdown: 4, stop })}
        onSend={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Continuing in 4s");
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop continuing" }));
    expect(stop).toHaveBeenCalled();
  });

  it("shows an achieved goal's summary, and only Clear", () => {
    render(
      <ChatGoalBar
        goal={{
          ...goal,
          status: "achieved",
          summary: "Login ships behind a flag.",
        }}
        canEdit
        busy={false}
        continuation={continuation()}
        onSend={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Achieved · Login ships behind a flag."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("is read-only for viewers", () => {
    render(
      <ChatGoalBar
        goal={goal}
        canEdit={false}
        busy={false}
        continuation={continuation()}
        onSend={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

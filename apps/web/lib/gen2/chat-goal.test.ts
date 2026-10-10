import type { Gen2TurnItem } from "@codev/contracts";
import { describe, expect, it } from "vitest";

import { deriveGen2ChatGoal } from "./chat-goal";

const user = (body: string) => ({ role: "user" as const, body });
const assistant = (items: Gen2TurnItem[] = []) => ({
  role: "assistant" as const,
  body: "ok",
  items,
});
const achieved: Gen2TurnItem = {
  id: "item_1:action:0",
  kind: "workspaceAction",
  status: "completed",
  token: "abc123xyz0",
  action: { type: "update_goal", status: "achieved", summary: "All green." },
  error: null,
};

describe("gen2 chat goal", () => {
  it("has no goal until a /goal message sets one", () => {
    expect(deriveGen2ChatGoal([user("hi"), assistant()])).toBeNull();
    expect(
      deriveGen2ChatGoal([user("/goal Make the tests pass"), assistant()]),
    ).toEqual({ text: "Make the tests pass", status: "active", summary: null });
  });

  it("marks the goal achieved from the agent's report or /goal done", () => {
    expect(
      deriveGen2ChatGoal([user("/goal Ship it"), assistant([achieved])]),
    ).toEqual({ text: "Ship it", status: "achieved", summary: "All green." });
    expect(
      deriveGen2ChatGoal([
        user("/goal Ship it"),
        assistant(),
        user("/goal done"),
      ]),
    ).toMatchObject({ status: "achieved" });
  });

  it("ignores a report when no goal is active", () => {
    expect(deriveGen2ChatGoal([assistant([achieved])])).toBeNull();
  });

  it("is replaced by a newer goal and ended by /goal clear", () => {
    const messages = [
      user("/goal First"),
      assistant([achieved]),
      user("/goal Second"),
    ];
    expect(deriveGen2ChatGoal(messages)).toMatchObject({
      text: "Second",
      status: "active",
    });
    expect(deriveGen2ChatGoal([...messages, user("/goal clear")])).toBeNull();
  });

  it("caps a long goal", () => {
    expect(
      deriveGen2ChatGoal([user(`/goal ${"x".repeat(5_000)}`)])?.text,
    ).toHaveLength(1_000);
  });
});

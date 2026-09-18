import { describe, expect, it } from "vitest";

import {
  canStartFreshChat,
  deriveFreshChatSessionName,
} from "./agent-fresh-chat";

describe("fresh chat on an existing agent", () => {
  it("numbers the second conversation on an agent", () => {
    expect(deriveFreshChatSessionName("Fix login", [])).toBe("Fix login 2");
  });

  it("skips names already taken on the same worktree", () => {
    expect(
      deriveFreshChatSessionName("Fix login", ["Fix login 2", "Fix login 3"]),
    ).toBe("Fix login 4");
  });

  it("does not stack counters when starting a chat from a numbered one", () => {
    expect(deriveFreshChatSessionName("Fix login 2", ["Fix login 2"])).toBe(
      "Fix login 3",
    );
  });

  it("keeps the derived name within the session name limit", () => {
    const name = deriveFreshChatSessionName("x".repeat(40), []);
    expect(name.length).toBeLessThanOrEqual(32);
    expect(name.endsWith(" 2")).toBe(true);
  });

  it("falls back to a usable name when the source name is blank", () => {
    expect(deriveFreshChatSessionName("   ", [])).toBe("Agent 2");
  });

  it("only allows a fresh chat while the worktree is live", () => {
    expect(canStartFreshChat("active")).toBe(true);
    expect(canStartFreshChat("frozen")).toBe(true);
    expect(canStartFreshChat("discarded")).toBe(false);
  });
});

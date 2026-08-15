import { describe, expect, it } from "vitest";

import { toNormalizedProviderEvents } from "./provider-event-view";
import {
  CONTROLLED_LAST_ACTION_OUTPUT,
  CONTROLLED_LAST_ACTION_TOOL,
} from "./shared-session-view";

describe("normalized provider events", () => {
  it("maps a fixture OpenAI session to turn, status, output, tool, and usage events", () => {
    const events = toNormalizedProviderEvents({
      turns: [
        {
          id: "turn-1",
          authorId: "user-1",
          prompt: "Inspect the repository layout.",
          status: "completed",
          output: CONTROLLED_LAST_ACTION_OUTPUT,
          createdAt: "2026-08-15T23:00:00.000Z",
        },
      ],
      events: [
        {
          id: "event-1",
          turnId: "turn-1",
          type: "tool.completed",
          payload: {
            name: CONTROLLED_LAST_ACTION_TOOL,
            text: CONTROLLED_LAST_ACTION_OUTPUT,
            inputTokens: 12,
            outputTokens: 24,
          },
          createdAt: "2026-08-15T23:00:01.000Z",
        },
      ],
    });

    expect(events.map((event) => [event.kind, event.detail])).toEqual([
      ["turn", "Inspect the repository layout."],
      ["status", "completed"],
      ["output", CONTROLLED_LAST_ACTION_OUTPUT],
      ["tool_call", CONTROLLED_LAST_ACTION_TOOL],
      ["tool_result", CONTROLLED_LAST_ACTION_OUTPUT],
      ["usage", "12 in / 24 out"],
    ]);
  });

  it("adds a cancellation event for an interrupted turn", () => {
    const events = toNormalizedProviderEvents({
      turns: [
        {
          id: "turn-2",
          authorId: "user-1",
          prompt: "Controlled shared-session turn",
          status: "interrupted",
          createdAt: "2026-08-15T23:01:00.000Z",
        },
      ],
      events: [],
    });

    expect(events.some((event) => event.kind === "cancellation")).toBe(true);
    expect(events.find((event) => event.kind === "status")?.detail).toBe(
      "interrupted",
    );
  });
});

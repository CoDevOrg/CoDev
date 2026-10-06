import { describe, expect, it } from "vitest";
import { reduceCursorTurn } from "./cursor-turn-events";
import { settleGen2Turn } from "./turn-reducer";
const ndjson = (...events: unknown[]) =>
  events.map((event) => JSON.stringify(event)).join("\n");
describe("Cursor turn stream", () => {
  it("updates tool cards in place and preserves the complete saved reply", () => {
    const started = {
      type: "tool_call",
      subtype: "started",
      call_id: "write-1",
      tool_call: { writeToolCall: { args: { path: "/workspace/check.txt" } } },
    };
    const completed = { ...started, subtype: "completed" };
    const message = {
      type: "assistant",
      message: { content: [{ type: "text", text: "Done" }] },
    };
    const prefix = ndjson(started, message);
    const output = ndjson(started, message, completed, {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Done",
    });
    expect(reduceCursorTurn(prefix).items[0]?.id).toBe("write-1");
    expect(reduceCursorTurn(output)).toMatchObject({
      status: "completed",
      reply: "Done",
      items: [
        {
          id: "write-1",
          status: "completed",
          changes: [{ path: "check.txt", change: "modify" }],
        },
        { kind: "message", text: "Done" },
      ],
    });
    expect(reduceCursorTurn(output).items).toHaveLength(2);
  });
  it("ignores partial output and fails an exited process without a terminal result", () => {
    expect(reduceCursorTurn("noise\n{")).toMatchObject({
      status: "running",
      items: [],
    });
    expect(
      settleGen2Turn("cursor", "Error: authentication required", 1).state,
    ).toMatchObject({
      status: "failed",
      error: "Cursor exited (code 1) without a result.",
    });
  });
  it("retains a failed result", () => {
    expect(
      reduceCursorTurn(
        ndjson({
          type: "result",
          subtype: "error",
          is_error: true,
          result: "Access denied",
        }),
      ),
    ).toMatchObject({ status: "failed", error: "Access denied" });
  });
  it("explains Cursor's plain-text named-model quota rejection", () => {
    expect(
      settleGen2Turn(
        "cursor",
        "ActionRequiredError: Increase limits for faster responses You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue.",
        1,
      ).state,
    ).toMatchObject({
      status: "failed",
      error:
        "Your Cursor account is out of usage for this model. Choose Auto or increase your Cursor usage limit.",
    });
  });
});

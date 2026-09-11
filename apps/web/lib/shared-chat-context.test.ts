import { describe, expect, it } from "vitest";
import {
  buildSharedChatContext,
  codexFinalMessage,
} from "./shared-chat-context";

describe("room reply context", () => {
  it("keeps chronological recent messages, excluding unfinished replies", () => {
    const context = buildSharedChatContext([
      { role: "user", authorName: "Alice", text: "Earlier" },
      {
        role: "assistant",
        authorName: "Claude",
        text: "Failure",
        generation: { provider: "claude", model: "m", status: "failed" },
      },
      {
        role: "assistant",
        authorName: "Claude",
        text: "Pending",
        generation: { provider: "claude", model: "m", status: "pending" },
      },
      { role: "user", authorName: "Bob", text: "Latest" },
    ]);
    expect(context).toContain("[user: Alice]\nEarlier");
    expect(context).toContain("[user: Bob]\nLatest");
    expect(context).not.toMatch(/Failure|Pending/);
    expect(context.indexOf("Earlier")).toBeLessThan(context.indexOf("Latest"));
  });
  it("bounds history while preserving the latest request", () => {
    const context = buildSharedChatContext([
      { role: "user", authorName: null, text: "x".repeat(80_000) },
      { role: "user", authorName: null, text: "Latest request" },
    ]);
    expect(context).toContain("Older conversation content omitted");
    expect(context).toContain("Latest request");
    expect(context.length).toBeLessThan(80_000);
  });
  it("only takes the final CLI answer and ignores diagnostics", () => {
    expect(
      codexFinalMessage(
        'secret diagnostic\n{"type":"item.completed","item":{"type":"agent_message","text":"Answer"}}',
      ),
    ).toBe("Answer");
  });
});

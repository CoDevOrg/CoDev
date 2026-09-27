import { describe, expect, it } from "vitest";

import {
  decodeReplyBytes,
  extractPartialClaudeText,
  extractPartialCodexText,
  extractPartialReplyText,
} from "./room-reply-stream";

/** The transport hands the workflow one code unit per byte; mirror that here. */
function asTransportBytes(text: string) {
  return [...Buffer.from(text, "utf8")]
    .map((byte) => String.fromCharCode(byte))
    .join("");
}

const claudeDelta = (text: string) =>
  JSON.stringify({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text },
    },
  });

describe("decodeReplyBytes", () => {
  it("round-trips multibyte output", () => {
    expect(decodeReplyBytes(asTransportBytes("héllo — 世界"))).toBe(
      "héllo — 世界",
    );
  });
});

describe("extractPartialClaudeText", () => {
  it("accumulates streaming deltas and ignores the incomplete trailing line", () => {
    const output = [
      JSON.stringify({ type: "system", subtype: "init" }),
      claudeDelta("Hello"),
      claudeDelta(", room"),
      '{"type":"stream_event","event":{"type":"content_bl',
    ].join("\n");
    expect(extractPartialClaudeText(output)).toBe("Hello, room");
  });

  it("treats an assistant message as a snapshot that supersedes its deltas", () => {
    const output = `${[
      claudeDelta("Hel"),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello, room." }] },
      }),
    ].join("\n")}\n`;
    expect(extractPartialClaudeText(output)).toBe("Hello, room.");
  });

  it("prefers the authoritative result line once it arrives", () => {
    const output = `${[
      claudeDelta("partial"),
      JSON.stringify({ type: "result", result: "The final answer." }),
    ].join("\n")}\n`;
    expect(extractPartialClaudeText(output)).toBe("The final answer.");
  });

  it("skips synthetic API-error messages", () => {
    const output = `${JSON.stringify({
      type: "assistant",
      is_api_error_message: true,
      message: { content: [{ type: "text", text: "Not logged in" }] },
    })}\n`;
    expect(extractPartialClaudeText(output)).toBe("");
  });

  it("returns nothing rather than throwing on unrecognized output", () => {
    expect(extractPartialClaudeText("not json at all\n")).toBe("");
    expect(extractPartialClaudeText("")).toBe("");
  });
});

describe("extractPartialCodexText", () => {
  it("follows the latest agent message as it grows", () => {
    const output = `${[
      JSON.stringify({
        type: "item.updated",
        item: { type: "agent_message", text: "Draft" },
      }),
      JSON.stringify({
        type: "item.updated",
        item: { type: "agent_message", text: "Draft answer" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Draft answer, done." },
      }),
    ].join("\n")}\n`;
    expect(extractPartialCodexText(output)).toBe("Draft answer, done.");
  });

  it("ignores non-message items", () => {
    const output = `${JSON.stringify({
      type: "item.completed",
      item: { type: "reasoning", text: "thinking" },
    })}\n`;
    expect(extractPartialCodexText(output)).toBe("");
  });
});

describe("extractPartialReplyText", () => {
  it("dispatches on provider", () => {
    const codex = `${JSON.stringify({
      type: "item.updated",
      item: { type: "agent_message", text: "from codex" },
    })}\n`;
    expect(extractPartialReplyText(codex, "codex")).toBe("from codex");
    expect(extractPartialReplyText(codex, "claude")).toBe("");
  });
});

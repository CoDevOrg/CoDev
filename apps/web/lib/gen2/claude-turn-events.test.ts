import { describe, expect, it } from "vitest";

import { reduceClaudeTurn } from "./claude-turn-events";
import { reduceGen2Turn, settleGen2Turn } from "./turn-reducer";

const line = (event: unknown) => JSON.stringify(event);

const STREAM = [
  line({ type: "system", subtype: "init", session_id: "s" }),
  line({
    type: "assistant",
    message: {
      id: "msg_1",
      content: [{ type: "text", text: "Looking around." }],
    },
  }),
  line({
    type: "assistant",
    message: {
      id: "msg_1",
      content: [
        {
          type: "tool_use",
          id: "toolu_bash",
          name: "Bash",
          input: { command: "ls" },
        },
      ],
    },
  }),
  line({
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "toolu_bash", content: "a.ts\n" },
      ],
    },
  }),
  line({
    type: "assistant",
    message: {
      id: "msg_2",
      content: [
        {
          type: "tool_use",
          id: "toolu_edit",
          name: "Edit",
          input: { file_path: "/workspace/src/a.ts" },
        },
      ],
    },
  }),
  line({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_edit",
          content: [{ type: "text", text: "boom" }],
          is_error: true,
        },
      ],
    },
  }),
  line({
    type: "assistant",
    message: { id: "msg_3", content: [{ type: "text", text: "Done." }] },
  }),
  line({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Done.",
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 4,
      output_tokens: 6,
    },
  }),
];

describe("reduceClaudeTurn", () => {
  it("turns the stream into cards, finishing tools from their results", () => {
    const state = reduceClaudeTurn(STREAM.join("\n"));
    expect(state.items).toEqual([
      {
        id: "msg_1:0",
        kind: "message",
        status: "completed",
        text: "Looking around.",
      },
      {
        id: "toolu_bash",
        kind: "command",
        status: "completed",
        command: "ls",
        output: "a.ts\n",
        exitCode: 0,
      },
      {
        id: "toolu_edit",
        kind: "fileChange",
        status: "failed",
        changes: [{ path: "src/a.ts", change: "modify" }],
      },
      { id: "msg_3:0", kind: "message", status: "completed", text: "Done." },
    ]);
    expect(state.reply).toBe("Done.");
    expect(state.status).toBe("completed");
    expect(state.usage).toEqual({
      inputTokens: 10,
      cachedInputTokens: 4,
      outputTokens: 6,
    });
  });

  it("is idempotent over every prefix of the stream", () => {
    const full = reduceClaudeTurn(STREAM.join("\n"));
    for (let count = 1; count <= STREAM.length; count += 1) {
      const prefix = reduceClaudeTurn(STREAM.slice(0, count).join("\n"));
      // Ids never change, so React keys never churn as the stream grows.
      expect(prefix.items.map((item) => item.id)).toEqual(
        full.items.slice(0, prefix.items.length).map((item) => item.id),
      );
    }
  });

  it("gives a message's several blocks distinct, stable ids", () => {
    const state = reduceClaudeTurn(
      [
        line({
          type: "assistant",
          message: { id: "m", content: [{ type: "thinking", thinking: "hm" }] },
        }),
        line({
          type: "assistant",
          message: { id: "m", content: [{ type: "text", text: "ok" }] },
        }),
      ].join("\n"),
    );
    expect(state.items.map((item) => item.id)).toEqual(["m:0", "m:1"]);
  });

  it("skips noise, a partial trailing line, and sub-agent events", () => {
    const state = reduceClaudeTurn(
      [
        "\u001b[?2004hnoise",
        line({
          type: "assistant",
          parent_tool_use_id: "toolu_task",
          message: { id: "sub", content: [{ type: "text", text: "inner" }] },
        }),
        STREAM[1],
        '{"type":"assistant","message":{"id":"m',
      ].join("\r\n"),
    );
    expect(state.items).toHaveLength(1);
    expect(state.status).toBe("running");
  });

  it("reports a failed result as the turn's error", () => {
    const state = reduceClaudeTurn(
      line({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Invalid API key",
      }),
    );
    expect(state.status).toBe("failed");
    expect(state.error).toBe("Invalid API key");
    expect(state.reply).toBe("");
  });

  it("falls back to the result text when no message card arrived", () => {
    const state = reduceClaudeTurn(
      line({ type: "result", subtype: "success", result: "hello" }),
    );
    expect(state.reply).toBe("hello");
  });
});

const NL = String.fromCharCode(10);

describe("reduceGen2Turn", () => {
  const codex = [
    line({ type: "thread.started", thread_id: "t" }),
    line({
      type: "item.completed",
      item: { id: "i1", type: "agent_message", text: "from codex" },
    }),
    line({ type: "turn.completed", usage: {} }),
  ].join(NL);

  it("reads the stream with the parser of the provider that was asked", () => {
    expect(reduceGen2Turn("claude", STREAM.join(NL)).reply).toBe("Done.");
    expect(reduceGen2Turn("codex", codex).reply).toBe("from codex");
  });

  it("does not read one provider's stream with another's parser", () => {
    expect(reduceGen2Turn("codex", STREAM.join(NL)).items).toEqual([]);
    expect(reduceGen2Turn("claude", codex).items).toEqual([]);
  });
});

describe("settleGen2Turn", () => {
  it("passes a finished turn through untouched", () => {
    const settled = settleGen2Turn("claude", STREAM.join(NL), 0);
    expect(settled.unparsed).toBe(false);
    expect(settled.state.status).toBe("completed");
    expect(settled.state.error).toBeNull();
  });

  it("fails an exited turn the parser never saw a result for", () => {
    // e.g. the CLI printed plain text instead of its JSON stream.
    const settled = settleGen2Turn("claude", "claude: command not found", 127);
    expect(settled.unparsed).toBe(true);
    expect(settled.state.status).toBe("failed");
    expect(settled.state.error).toBe(
      "Claude exited (code 127) without a result.",
    );
    // The member-facing message never carries the raw output.
    expect(settled.state.error).not.toContain("command not found");
  });

  it("fails a stream in the wrong provider's format the same way", () => {
    const settled = settleGen2Turn("codex", STREAM.join(NL), 0);
    expect(settled.state.status).toBe("failed");
    expect(settled.state.error).toBe("Codex exited (code 0) without a result.");
  });
});

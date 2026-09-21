import { describe, expect, it } from "vitest";

import { reduceCodexTurn, toWorkspaceRelativePath } from "./turn-events";

/** A turn shaped like a real `codex exec --json` run, one event per line. */
const STREAM = [
  `{"type":"thread.started","thread_id":"th_1"}`,
  `{"type":"turn.started"}`,
  `{"type":"item.started","item":{"id":"item_0","type":"reasoning","text":""}}`,
  `{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"**Reading the repo**"}}`,
  `{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","aggregated_output":""}}`,
  `{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","aggregated_output":"README.md\\n","exit_code":0,"status":"completed"}}`,
  `{"type":"item.completed","item":{"id":"item_2","type":"todo_list","items":[{"text":"Edit README","completed":true}]}}`,
  `{"type":"item.completed","item":{"id":"item_3","type":"file_change","changes":[{"path":"/workspace/README.md","kind":"modify"},{"path":"/workspace/src/new.ts","kind":"add"}]}}`,
  `{"type":"item.completed","item":{"id":"item_4","type":"agent_message","text":"Updated the README."}}`,
  `{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":64,"output_tokens":31}}`,
].join("\n");

describe("reduceCodexTurn", () => {
  it("reduces a whole turn into ordered, typed items", () => {
    const state = reduceCodexTurn(STREAM);
    expect(state.items.map((item) => [item.id, item.kind])).toEqual([
      ["item_0", "reasoning"],
      ["item_1", "command"],
      ["item_2", "todoList"],
      ["item_3", "fileChange"],
      ["item_4", "message"],
    ]);
    expect(state.status).toBe("completed");
    expect(state.reply).toBe("Updated the README.");
    expect(state.error).toBeNull();
    expect(state.usage).toEqual({
      inputTokens: 120,
      cachedInputTokens: 64,
      outputTokens: 31,
    });
  });

  it("replaces a started item in place rather than appending a second card", () => {
    const state = reduceCodexTurn(STREAM);
    const commands = state.items.filter((item) => item.kind === "command");
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      command: "bash -lc ls",
      output: "README.md\n",
      exitCode: 0,
      status: "completed",
    });
  });

  it("keeps an item's original position when it completes late", () => {
    const interleaved = [
      `{"type":"item.started","item":{"id":"a","type":"command_execution","command":"slow"}}`,
      `{"type":"item.completed","item":{"id":"b","type":"reasoning","text":"quick"}}`,
      `{"type":"item.completed","item":{"id":"a","type":"command_execution","command":"slow","exit_code":0}}`,
    ].join("\n");
    expect(reduceCodexTurn(interleaved).items.map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("is idempotent across a growing prefix, so React keys never churn", () => {
    const lines = STREAM.split("\n");
    const seen: string[][] = [];
    for (let count = 1; count <= lines.length; count += 1) {
      seen.push(
        reduceCodexTurn(lines.slice(0, count).join("\n")).items.map(
          (item) => item.id,
        ),
      );
    }
    // Every prefix's ids are a prefix of the final ids: nothing is reordered
    // or re-keyed as more of the stream arrives.
    const final = seen.at(-1)!;
    for (const ids of seen) {
      expect(final.slice(0, ids.length)).toEqual(ids);
    }
  });

  it("ignores PTY noise and a partial trailing line", () => {
    const noisy = [
      "codex v1.2.3 starting",
      `{"type":"item.completed","item":{"id":"x","type":"agent_message","text":"done"}}`,
      `{"type":"item.completed","item":{"id":"y","type":"agent_mess`,
    ].join("\n");
    const state = reduceCodexTurn(noisy);
    expect(state.items.map((item) => item.id)).toEqual(["x"]);
    expect(state.reply).toBe("done");
  });

  it("records an error and marks the turn failed", () => {
    const failed = [
      `{"type":"item.completed","item":{"id":"m","type":"agent_message","text":"partial"}}`,
      `{"type":"turn.failed","error":{"message":"rate limited"}}`,
    ].join("\n");
    const state = reduceCodexTurn(failed);
    expect(state.status).toBe("failed");
    expect(state.error).toBe("rate limited");
    // The partial reply survives so the thread is not left blank.
    expect(state.reply).toBe("partial");
  });

  it("normalises guest paths so a card can link into the editor", () => {
    const state = reduceCodexTurn(STREAM);
    const change = state.items.find((item) => item.kind === "fileChange");
    expect(change).toMatchObject({
      changes: [
        { path: "README.md", change: "modify" },
        { path: "src/new.ts", change: "add" },
      ],
    });
  });

  it("skips item types it has no card for instead of throwing", () => {
    const state = reduceCodexTurn(
      `{"type":"item.completed","item":{"id":"z","type":"something_new","text":"?"}}`,
    );
    expect(state.items).toEqual([]);
    expect(state.status).toBe("running");
  });

  it("treats an empty stream as a running turn", () => {
    expect(reduceCodexTurn("")).toEqual({
      items: [],
      reply: "",
      error: null,
      usage: null,
      status: "running",
    });
  });
});

describe("toWorkspaceRelativePath", () => {
  it("strips the guest workspace root and leading ./", () => {
    expect(toWorkspaceRelativePath("/workspace/src/a.ts")).toBe("src/a.ts");
    expect(toWorkspaceRelativePath("./src/a.ts")).toBe("src/a.ts");
    expect(toWorkspaceRelativePath("src/a.ts")).toBe("src/a.ts");
  });
});

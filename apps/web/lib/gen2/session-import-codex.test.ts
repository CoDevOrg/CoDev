import { describe, expect, it } from "vitest";

import { parseCodexSession } from "./session-import-codex";

const ID = "01a0fb8e-879a-7a12-8eeb-e52297ff6ffa";
const CWD = "C:\\work\\repo";
const AT = "2026-10-02T03:40:17.000Z";

const meta = {
  type: "session_meta",
  timestamp: AT,
  payload: {
    id: ID,
    timestamp: AT,
    cwd: CWD,
    git: {
      repository_url: "https://github.com/o/r",
      branch: "main",
      commit_hash: "abc123",
    },
  },
};
const completed = (item: Record<string, unknown>) => ({
  type: "event_msg",
  timestamp: AT,
  payload: { type: "item_completed", item },
});
const response = (payload: Record<string, unknown>) => ({
  type: "response_item",
  timestamp: AT,
  payload,
});

describe("Codex rollout import", () => {
  it("reads current rollouts from completed thread items", () => {
    const session = parseCodexSession([
      meta,
      response({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "<environment_context>…" }],
      }),
      completed({
        type: "UserMessage",
        id: "u1",
        content: [
          {
            type: "Text",
            text: "# Files mentioned by the user:\n## a.ts\n## My request:\nFix the build",
          },
        ],
      }),
      completed({
        type: "Reasoning",
        id: "r1",
        summary_text: ["Looking at the build"],
      }),
      completed({
        type: "AgentMessage",
        id: "a1",
        phase: "commentary",
        content: [{ type: "Text", text: "Checking." }],
      }),
      completed({
        type: "CommandExecution",
        id: "c1",
        command: ["powershell.exe", "-Command", "pnpm build"],
        aggregated_output: "failed",
        exit_code: 1,
        status: "completed",
      }),
      completed({
        type: "FileChange",
        id: "f1",
        status: "completed",
        changes: {
          "C:\\work\\repo\\src\\a.ts": { type: "update" },
          "C:\\work\\repo\\b.ts": { type: "add" },
        },
      }),
      completed({
        type: "Extension",
        id: "w1",
        kind: "web.search",
        query: "vite error",
      }),
      completed({
        type: "AgentMessage",
        id: "a2",
        phase: "final_answer",
        content: [{ type: "Text", text: "Fixed it." }],
      }),
      completed({
        type: "UserMessage",
        id: "u2",
        content: [{ type: "Text", text: "Thanks" }],
      }),
    ]);

    expect(session).toMatchObject({
      nativeSessionId: ID,
      startedAt: AT,
      repo: {
        remote: "https://github.com/o/r",
        branch: "main",
        commit: "abc123",
      },
    });
    expect(session.messages.map((m) => [m.role, m.body])).toEqual([
      ["user", "Fix the build"],
      ["assistant", "Fixed it."],
      ["user", "Thanks"],
    ]);
    expect(session.messages[1]!.items).toEqual([
      {
        id: "r1",
        kind: "reasoning",
        status: "completed",
        text: "Looking at the build",
      },
      { id: "a1", kind: "message", status: "completed", text: "Checking." },
      {
        id: "c1",
        kind: "command",
        status: "failed",
        command: "pnpm build",
        output: "failed",
        exitCode: 1,
      },
      {
        id: "f1",
        kind: "fileChange",
        status: "completed",
        changes: [
          { path: "src/a.ts", change: "modify" },
          { path: "b.ts", change: "add" },
        ],
      },
      { id: "w1", kind: "webSearch", status: "completed", query: "vite error" },
    ]);
  });

  it("falls back to events and response tool calls in older rollouts", () => {
    const session = parseCodexSession([
      meta,
      {
        type: "event_msg",
        timestamp: AT,
        payload: { type: "user_message", message: "List files" },
      },
      response({
        type: "function_call",
        name: "shell",
        call_id: "call1",
        arguments: JSON.stringify({ command: ["bash", "-lc", "ls"] }),
      }),
      response({
        type: "function_call_output",
        call_id: "call1",
        output: JSON.stringify({
          output: "README.md",
          metadata: { exit_code: 0 },
        }),
      }),
      response({
        type: "function_call",
        name: "update_plan",
        call_id: "call2",
        arguments: JSON.stringify({
          plan: [{ step: "Look", status: "completed" }],
        }),
      }),
      response({
        type: "custom_tool_call",
        name: "apply_patch",
        call_id: "call3",
        input:
          "*** Begin Patch\n*** Add File: C:\\work\\repo\\new.ts\n*** End Patch",
      }),
      {
        type: "event_msg",
        timestamp: AT,
        payload: { type: "agent_message", message: "One file." },
      },
    ]);
    expect(session.messages).toEqual([
      { role: "user", body: "List files", items: null, createdAt: AT },
      {
        role: "assistant",
        body: "One file.",
        createdAt: AT,
        items: [
          {
            id: "call1",
            kind: "command",
            status: "completed",
            command: "ls",
            output: "README.md",
            exitCode: 0,
          },
          {
            id: "call2",
            kind: "todoList",
            status: "completed",
            todos: [{ text: "Look", completed: true }],
          },
          {
            id: "call3",
            kind: "fileChange",
            status: "completed",
            changes: [{ path: "new.ts", change: "add" }],
          },
        ],
      },
    ]);
  });

  it("skips injected context when only response messages exist", () => {
    const session = parseCodexSession([
      meta,
      response({
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "# AGENTS.md instructions for repo" },
        ],
      }),
      response({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hello" }],
      }),
      response({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Hi" }],
      }),
    ]);
    expect(session.messages.map((m) => m.body)).toEqual(["Hello", "Hi"]);
  });

  it("rejects files without a session header", () => {
    expect(() => parseCodexSession([{ type: "user", sessionId: ID }])).toThrow(
      /doesn't look like a Codex rollout/,
    );
    expect(() =>
      parseCodexSession([
        { ...meta, payload: { ...meta.payload, id: "../../etc" } },
      ]),
    ).toThrow(/doesn't look like a Codex rollout/);
  });
});

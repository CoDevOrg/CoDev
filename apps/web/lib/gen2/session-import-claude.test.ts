import { describe, expect, it } from "vitest";

import { parseClaudeSession } from "./session-import-claude";

const SESSION = "ed1d5840-87cc-4300-a4da-2733bbe91003";
const AT = "2026-10-08T10:00:00.000Z";
const base = {
  sessionId: SESSION,
  cwd: "/home/me/repo",
  gitBranch: "feature",
  timestamp: AT,
};

const user = (
  uuid: string,
  parentUuid: string | null,
  content: unknown,
  extra = {},
) => ({
  ...base,
  type: "user",
  uuid,
  parentUuid,
  message: { role: "user", content },
  ...extra,
});
const assistant = (uuid: string, parentUuid: string, block: unknown) => ({
  ...base,
  type: "assistant",
  uuid,
  parentUuid,
  message: { id: `msg-${uuid}`, role: "assistant", content: [block] },
});

describe("Claude Code transcript import", () => {
  it("follows the latest branch and pairs tool calls with results", () => {
    const session = parseClaudeSession([
      user("u1", null, "Add a test"),
      // An abandoned reply the member rewound past.
      assistant("old", "u1", { type: "text", text: "Abandoned" }),
      assistant("a1", "u1", { type: "thinking", thinking: "Plan it" }),
      assistant("a2", "a1", {
        type: "tool_use",
        id: "toolu_1",
        name: "Bash",
        input: { command: "pnpm test" },
      }),
      user("r1", "a2", [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: "1 failed",
          is_error: true,
        },
      ]),
      assistant("a3", "r1", {
        type: "tool_use",
        id: "toolu_2",
        name: "Edit",
        input: { file_path: "/home/me/repo/src/a.test.ts" },
      }),
      {
        ...assistant("side", "a3", { type: "text", text: "Sub-agent" }),
        isSidechain: true,
      },
      assistant("a4", "a3", { type: "text", text: "Added the test." }),
      user("m1", "a4", "<command-name>/clear</command-name>"),
      user("m2", "m1", [{ type: "text", text: "Caveat: local" }], {
        isMeta: true,
      }),
      user("u2", "m2", [{ type: "text", text: "Thanks" }]),
      { type: "custom-title", customTitle: "Test work", sessionId: SESSION },
    ]);

    expect(session).toMatchObject({
      nativeSessionId: SESSION,
      title: "Test work",
      cwd: "/home/me/repo",
      repo: { branch: "feature", remote: null, commit: null },
    });
    expect(session.messages.map((m) => [m.role, m.body])).toEqual([
      ["user", "Add a test"],
      ["assistant", "Added the test."],
      ["user", "Thanks"],
    ]);
    const items = session.messages[1]!.items!;
    expect(items.map((item) => item.kind)).toEqual([
      "reasoning",
      "command",
      "fileChange",
      "message",
    ]);
    expect(items[1]).toMatchObject({
      status: "failed",
      output: "1 failed",
      exitCode: 1,
    });
    expect(items[2]).toMatchObject({
      changes: [{ path: "src/a.test.ts", change: "modify" }],
    });
  });

  it("crosses compaction boundaries", () => {
    const session = parseClaudeSession([
      user("u1", null, "First"),
      assistant("a1", "u1", { type: "text", text: "One" }),
      {
        ...base,
        type: "system",
        subtype: "compact_boundary",
        uuid: "b1",
        parentUuid: null,
        logicalParentUuid: "a1",
      },
      user("s1", "b1", "Summary of earlier work", { isCompactSummary: true }),
      user("u2", "s1", "Second"),
      assistant("a2", "u2", { type: "text", text: "Two" }),
    ]);
    expect(session.messages.map((m) => m.body)).toEqual([
      "First",
      "One",
      "Second",
      "Two",
    ]);
  });

  it("rejects files without a session id", () => {
    expect(() => parseClaudeSession([{ type: "user" }])).toThrow(
      /doesn't look like a Claude Code transcript/,
    );
  });
});

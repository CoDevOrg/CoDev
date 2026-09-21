import { describe, expect, it } from "vitest";

import { importedTranscriptToTurns } from "./session-import-transcript-turns";

describe("imported session continuation", () => {
  it("converts normalized messages into completed CoDev turns", () => {
    const turns = importedTranscriptToTurns(
      [
        {
          sequence: 0,
          role: "system",
          authorName: null,
          text: "Work only in the repository.",
          createdAt: null,
        },
        {
          sequence: 1,
          role: "user",
          authorName: null,
          text: "Fix the failing test.",
          createdAt: "2026-09-20T12:00:00.000Z",
        },
        {
          sequence: 2,
          role: "assistant",
          authorName: "Codex",
          text: "I fixed it.",
          createdAt: null,
        },
        {
          sequence: 3,
          role: "tool",
          authorName: "Shell",
          text: "1 test passed",
          createdAt: null,
        },
        {
          sequence: 4,
          role: "user",
          authorName: null,
          text: "Thanks.",
          createdAt: null,
        },
      ],
      "2026-09-20T11:00:00.000Z",
    );

    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      prompt:
        "[Imported system context]\nWork only in the repository.\n\n[User message]\nFix the failing test.",
      output: "I fixed it.\n\n[Shell]\n1 test passed",
      createdAt: new Date("2026-09-20T12:00:00.000Z"),
    });
    expect(turns[1]).toMatchObject({
      prompt: "Thanks.",
      output: "[No agent response was recorded.]",
    });
  });

  it("preserves assistant-only context", () => {
    expect(
      importedTranscriptToTurns(
        [
          {
            sequence: 0,
            role: "assistant",
            authorName: null,
            text: "Recovered context",
            createdAt: null,
          },
        ],
        "2026-09-20T11:00:00.000Z",
      ),
    ).toMatchObject([
      {
        prompt: "Imported session context",
        output: "Recovered context",
      },
    ]);
  });
});

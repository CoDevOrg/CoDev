import { describe, expect, it } from "vitest";

import { readSessionImport } from "./session-import-parse";

const SESSION = "ed1d5840-87cc-4300-a4da-2733bbe91003";
const encode = (lines: unknown[]) =>
  new TextEncoder().encode(lines.map((l) => JSON.stringify(l)).join("\n"));
const turn = (n: number) => [
  {
    type: "user",
    sessionId: SESSION,
    uuid: `u${n}`,
    parentUuid: n ? `a${n - 1}` : null,
    message: {
      content: `Prompt ${n} uses sk-proj-abcdefghijklmnopqrstuvwxyz0123`,
    },
  },
  {
    type: "assistant",
    sessionId: SESSION,
    uuid: `a${n}`,
    parentUuid: `u${n}`,
    message: { id: `m${n}`, content: [{ type: "text", text: `Reply ${n}` }] },
  },
];

describe("reading an uploaded session", () => {
  it("parses the redacted text and builds a preview", () => {
    const lines = [0, 1, 2, 3].flatMap(turn);
    const { text, preview } = readSessionImport("claude", encode(lines));
    expect(text).not.toContain("sk-proj-");
    expect(preview).toMatchObject({
      provider: "claude",
      title: "Prompt 0 uses [REDACTED]",
      messageCount: 8,
      itemCount: 4,
      redactions: [{ kind: "OpenAI key", count: 4 }],
    });
    expect(preview.sample.map((m) => m.body)).toEqual([
      "Prompt 0 uses [REDACTED]",
      "Reply 0",
      "Prompt 1 uses [REDACTED]",
      "Reply 2",
      "Prompt 3 uses [REDACTED]",
      "Reply 3",
    ]);
  });

  it("tolerates a partial trailing line from a running session", () => {
    const bytes = new TextEncoder().encode(
      `${turn(0)
        .map((l) => JSON.stringify(l))
        .join("\n")}\n{"type":"assi`,
    );
    expect(readSessionImport("claude", bytes).preview.messageCount).toBe(2);
  });

  it("rejects empty, non-UTF-8, and message-less files", () => {
    expect(() => readSessionImport("claude", new Uint8Array())).toThrow(
      /isn't empty/,
    );
    expect(() =>
      readSessionImport("claude", new Uint8Array([0xff, 0xfe, 0xfd])),
    ).toThrow(/UTF-8/);
    expect(() =>
      readSessionImport(
        "claude",
        encode([{ type: "summary", sessionId: SESSION }]),
      ),
    ).toThrow(/no messages/);
  });
});

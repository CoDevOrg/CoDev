import { describe, expect, it } from "vitest";

import {
  deserializeGen2Mentions,
  formatGen2MentionToken,
  humanizeGen2Prompt,
  parseGen2MentionTokens,
  serializeGen2Mentions,
} from "./prompt-mentions";

const chatId = "11111111-1111-4111-8111-111111111111";

describe("gen2 prompt mentions", () => {
  it("round-trips paths with spaces, parentheses and brackets", () => {
    for (const ref of [
      "apps/web/app/gen2/(home)/page.tsx",
      "docs/My Notes (draft).md",
      "app/[workspaceId]/page.tsx",
      "src/it's*!.ts",
    ]) {
      const token = formatGen2MentionToken({ kind: "file", ref, label: ref });
      expect(parseGen2MentionTokens(`see ${token} please`)).toEqual([
        expect.objectContaining({ kind: "file", ref }),
      ]);
    }
  });

  it("strips characters that would break a label", () => {
    expect(
      formatGen2MentionToken({
        kind: "chat",
        ref: chatId,
        label: "Fix [login]\nflow",
      }),
    ).toBe(`@[Fix loginflow](chat:${chatId})`);
  });

  it("dedupes repeated mentions and skips malformed refs", () => {
    const token = formatGen2MentionToken({
      kind: "chat",
      ref: chatId,
      label: "Fix login",
    });
    expect(
      parseGen2MentionTokens(`${token} and ${token} and @[x](file:%E0%A4%A)`),
    ).toHaveLength(1);
  });

  it("serializes @labels into tokens without claiming a longer label", () => {
    const mentions = [
      { kind: "file" as const, ref: "src/a.ts", label: "src/a.ts" },
      { kind: "file" as const, ref: "src/a.tsx", label: "src/a.tsx" },
      { kind: "chat" as const, ref: chatId, label: "Fix login" },
    ];
    const serialized = serializeGen2Mentions(
      "Compare @src/a.tsx with @src/a.ts, like in @Fix login.",
      mentions,
    );
    expect(
      parseGen2MentionTokens(serialized).map((token) => token.ref),
    ).toEqual(["src/a.tsx", "src/a.ts", chatId]);
    expect(humanizeGen2Prompt(serialized)).toBe(
      "Compare @src/a.tsx with @src/a.ts, like in @Fix login.",
    );
  });

  it("drops a mention whose @label was edited away", () => {
    expect(
      serializeGen2Mentions("Look at the file", [
        { kind: "file", ref: "src/a.ts", label: "src/a.ts" },
      ]),
    ).toBe("Look at the file");
  });

  it("restores a draft with its mentions", () => {
    const text = serializeGen2Mentions("/plan Use @src/a.ts", [
      { kind: "file", ref: "src/a.ts", label: "src/a.ts" },
    ]);
    expect(deserializeGen2Mentions(text)).toEqual({
      text: "/plan Use @src/a.ts",
      mentions: [{ kind: "file", ref: "src/a.ts", label: "src/a.ts" }],
    });
    expect(humanizeGen2Prompt(text)).toBe("Use @src/a.ts");
  });
});

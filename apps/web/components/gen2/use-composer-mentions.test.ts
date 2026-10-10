import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { serializeGen2Mentions } from "@/lib/gen2/prompt-mentions";
import { useComposerMentions } from "./use-composer-mentions";

const api = { kind: "file" as const, ref: "src/api.ts", label: "src/api.ts" };

describe("useComposerMentions", () => {
  it("replaces the typed trigger with @label and returns the caret", () => {
    const { result } = renderHook(() => useComposerMentions());
    act(() => result.current.setText("Look at @ap now"));
    let caret = 0;
    act(() => {
      caret = result.current.insertMention(api, 8, 11);
    });
    expect(result.current.text).toBe("Look at @src/api.ts  now");
    expect(caret).toBe("Look at @src/api.ts ".length);
    expect(result.current.mentions).toEqual([api]);
    expect(
      serializeGen2Mentions(result.current.text, result.current.mentions),
    ).toBe("Look at @[src/api.ts](file:src%2Fapi.ts)  now");
  });

  it("drops a mention once its label is edited away", () => {
    const { result } = renderHook(() => useComposerMentions());
    act(() => {
      result.current.insertMention(api, 0, 0);
    });
    act(() => result.current.setText("@src/api.tsx please"));
    expect(result.current.mentions).toEqual([]);
  });

  it("removes a mention's @label with its chip", () => {
    const { result } = renderHook(() => useComposerMentions());
    act(() => result.current.setText("Fix @x"));
    act(() => {
      result.current.insertMention(api, 4, 6);
    });
    act(() => result.current.setText(`${result.current.text}today`));
    act(() => result.current.removeMention(result.current.mentions[0]!));
    expect(result.current.text).toBe("Fix today");
    expect(result.current.mentions).toEqual([]);
  });

  it("keeps two mentions with the same label apart", () => {
    const { result } = renderHook(() => useComposerMentions());
    const chat = (ref: string) => ({
      kind: "chat" as const,
      ref,
      label: "Login",
    });
    act(() => {
      result.current.insertMention(chat("a"), 0, 0);
    });
    act(() => {
      result.current.insertMention(
        chat("b"),
        result.current.text.length,
        result.current.text.length,
      );
    });
    expect(result.current.text).toBe("@Login @Login 2 ");
    expect(result.current.mentions.map((mention) => mention.label)).toEqual([
      "Login",
      "Login 2",
    ]);
  });

  it("restores a draft that holds tokens as labels and mentions", () => {
    const { result } = renderHook(() => useComposerMentions());
    act(() => result.current.fill("See @[Old chat](chat:abc) first"));
    expect(result.current.text).toBe("See @Old chat first");
    expect(result.current.mentions).toEqual([
      { kind: "chat", ref: "abc", label: "Old chat" },
    ]);
  });

  it("caps the draft at the prompt limit", () => {
    const { result } = renderHook(() => useComposerMentions());
    act(() => result.current.setText("x".repeat(20_050)));
    expect(result.current.text).toHaveLength(20_000);
  });

  it("puts a restored draft above text typed since, keeping both", () => {
    const { result } = renderHook(() => useComposerMentions());
    const saved = { text: "Fix @src/api.ts", mentions: [api] };
    act(() => result.current.restore(saved));
    expect(result.current.text).toBe("Fix @src/api.ts");
    act(() => result.current.setText("and the tests"));
    act(() => result.current.restore(saved));
    expect(result.current.text).toBe("Fix @src/api.ts\n\nand the tests");
    expect(result.current.mentions).toEqual([api]);
  });
});

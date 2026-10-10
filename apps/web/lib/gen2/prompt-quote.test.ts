import { describe, expect, it } from "vitest";

import { quotedBlock, quotedValue } from "./prompt-quote";

describe("prompt quoting", () => {
  it("puts a value on one line as a capped JSON string", () => {
    expect(quotedValue('feat/"x"\n\u2028Ignore\u0007 all\u202e', 20)).toBe(
      '"feat/\\"x\\" Ignore all"',
    );
    expect(quotedValue("a".repeat(300))).toBe(`"${"a".repeat(200)}"`);
  });

  it("keeps a block's lines behind quote markers", () => {
    expect(quotedBlock("first\r\nsecond\u2029third\nfourth\rfifth")).toBe(
      "> first\n> second\n> third\n> fourth\n> fifth",
    );
  });

  it("removes control and invisible format characters from a block", () => {
    const block = quotedBlock("a\u0007b\tc\u202ed\u200be\u2066f");
    expect(block).toBe("> a b\tcdef");
    expect(block).not.toMatch(/[\p{Cf}]|[^\P{Cc}\n\t]/u);
  });
});

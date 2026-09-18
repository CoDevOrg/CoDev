import { describe, expect, it } from "vitest";

import {
  estimateTokenUsage,
  formatTokenCount,
  normalizeTokenUsage,
} from "./token-usage";

describe("token usage helpers", () => {
  it("normalizes provider usage shapes", () => {
    expect(
      normalizeTokenUsage({
        inputTokens: 10.2,
        outputTokens: 5,
        totalTokens: 15,
      }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    expect(
      normalizeTokenUsage({
        promptTokens: 8,
        completionTokens: 2,
      }),
    ).toEqual({
      inputTokens: 8,
      outputTokens: 2,
      totalTokens: 10,
    });
    expect(normalizeTokenUsage({})).toBeUndefined();
  });

  it("estimates tokens from text length", () => {
    expect(estimateTokenUsage("abcd").totalTokens).toBe(1);
    expect(estimateTokenUsage("abcdefgh").totalTokens).toBe(2);
    expect(formatTokenCount(1234)).toBe("1,234");
  });
});

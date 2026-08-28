import { describe, expect, it } from "vitest";

import {
  DUPLICATE_LEXICAL_ONLY,
  keywordSimilarity,
  keywordsFromText,
  overlappingPaths,
  resolveDuplicateIntent,
  tokenize,
} from "./workspace-brain";

describe("tokenize", () => {
  it("lowercases, drops stopwords and short tokens, de-duplicates", () => {
    expect(tokenize("Fix the login redirect bug in the login form")).toEqual([
      "login",
      "redirect",
      "bug",
      "form",
    ]);
  });

  it("splits on any non-alphanumeric boundary", () => {
    expect(tokenize("apps/web/lib/auth-session.ts")).toEqual([
      "apps",
      "web",
      "lib",
      "auth",
      "session",
    ]);
  });
});

describe("keywordsFromText", () => {
  it("ranks tokens by frequency across the supplied fragments", () => {
    const keywords = keywordsFromText([
      "session cookie handling",
      "the session cookie is dropped",
      "cookie parsing",
    ]);
    expect(keywords.slice(0, 2)).toEqual(["cookie", "session"]);
  });

  it("caps the returned set", () => {
    const many = Array.from({ length: 80 }, (_, i) => `token${i}`).join(" ");
    expect(keywordsFromText([many], 10)).toHaveLength(10);
  });
});

describe("keywordSimilarity", () => {
  it("catches the same work described with different words", () => {
    const a = keywordsFromText([
      "fix the broken login flow for returning users",
    ]);
    const b = keywordsFromText([
      "returning users cannot log in, repair the login flow",
    ]);
    expect(keywordSimilarity(a, b)).toBeGreaterThanOrEqual(
      DUPLICATE_LEXICAL_ONLY,
    );
  });

  it("stays low for unrelated goals that share one word", () => {
    const a = keywordsFromText(["add a dark mode toggle to settings"]);
    const b = keywordsFromText(["settings page performance is slow on mobile"]);
    expect(keywordSimilarity(a, b)).toBeLessThan(0.34);
  });

  it("is zero when either set is empty", () => {
    expect(keywordSimilarity([], ["login"])).toBe(0);
  });
});

describe("overlappingPaths", () => {
  it("matches exact files and directory globs", () => {
    expect(
      overlappingPaths(
        ["apps/web/lib/auth.ts", "apps/web/lib/session.ts"],
        ["apps/web/lib/**"],
      ),
    ).toEqual([
      "apps/web/lib/auth.ts ∩ apps/web/lib/**",
      "apps/web/lib/session.ts ∩ apps/web/lib/**",
    ]);
  });

  it("returns nothing when the trees are disjoint", () => {
    expect(
      overlappingPaths(["apps/web/lib/auth.ts"], ["services/orchestrator/**"]),
    ).toEqual([]);
  });
});

describe("resolveDuplicateIntent", () => {
  it("trusts an adjudicator that says the pair is the same work", () => {
    const decision = resolveDuplicateIntent(0.3, {
      sameWork: true,
      confidence: 0.9,
      rationale: "Both fix the same 500 on checkout.",
    });
    expect(decision).toMatchObject({
      record: true,
      score: 0.9,
      adjudicated: true,
      rationale: "Both fix the same 500 on checkout.",
    });
  });

  it("drops a lexically-similar pair the adjudicator clears", () => {
    expect(
      resolveDuplicateIntent(0.62, {
        sameWork: false,
        confidence: 0.2,
        rationale: "Different files, complementary work.",
      }).record,
    ).toBe(false);
  });

  it("falls back to a strict lexical threshold with no adjudicator", () => {
    expect(resolveDuplicateIntent(0.62, undefined)).toMatchObject({
      record: true,
      adjudicated: false,
    });
    expect(resolveDuplicateIntent(0.3, undefined).record).toBe(false);
  });
});

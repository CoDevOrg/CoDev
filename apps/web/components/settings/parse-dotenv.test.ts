import { describe, expect, it } from "vitest";

import { environmentNameError, parseDotenv } from "./parse-dotenv";

describe("parseDotenv", () => {
  it("reads assignments, skipping blanks and comments", () => {
    const result = parseDotenv(
      [
        "# database",
        "",
        "DATABASE_URL=postgres://x",
        "export API_KEY='abc'",
      ].join("\n"),
    );
    expect(result.entries).toEqual([
      { name: "DATABASE_URL", value: "postgres://x" },
      { name: "API_KEY", value: "abc" },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("strips inline comments from unquoted values only", () => {
    const result = parseDotenv('A=one # note\nB="two # kept"');
    expect(result.entries).toEqual([
      { name: "A", value: "one" },
      { name: "B", value: "two # kept" },
    ]);
  });

  it("lets a later duplicate win and reports unusable lines", () => {
    const result = parseDotenv("A=1\nnot an assignment\n1BAD=x\nEMPTY=\nA=2");
    expect(result.entries).toEqual([{ name: "A", value: "2" }]);
    expect(result.skipped).toEqual([2, 3, 4]);
  });

  it("handles CRLF line endings", () => {
    expect(parseDotenv("A=1\r\nB=2\r\n").entries).toHaveLength(2);
  });
});

describe("environmentNameError", () => {
  it("accepts valid names and blank input", () => {
    expect(environmentNameError("DATABASE_URL")).toBeNull();
    expect(environmentNameError("")).toBeNull();
  });

  it("explains why a name is rejected", () => {
    expect(environmentNameError("1ABC")).toMatch(/number/);
    expect(environmentNameError("not valid")).toMatch(/underscores/);
  });
});

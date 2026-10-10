import { describe, expect, it } from "vitest";

import { readTerminalTail } from "./workspace-terminal-tail";

function buffer(rows: Array<string | [string, "wrapped"]>) {
  return {
    length: rows.length,
    getLine: (y: number) => {
      const row = rows[y];
      if (row === undefined) return undefined;
      const [text, wrapped] = typeof row === "string" ? [row] : row;
      return {
        isWrapped: wrapped === "wrapped",
        translateToString: () => text,
      };
    },
  };
}

describe("readTerminalTail", () => {
  it("joins wrapped rows and drops blank rows below the prompt", () => {
    expect(
      readTerminalTail(
        buffer([
          "$ npm run build",
          "error: very lon",
          ["g line", "wrapped"],
          "$ ",
          "",
          "",
        ]),
      ),
    ).toBe("$ npm run build\nerror: very long line\n$ ");
  });

  it("keeps the last 40 lines and 2,000 characters", () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index}`);
    const tail = readTerminalTail(buffer(lines)).split("\n");
    expect(tail).toHaveLength(40);
    expect(tail[0]).toBe("line 60");
    const long = readTerminalTail(buffer(["x".repeat(5_000)]));
    expect(long).toHaveLength(2_000);
  });

  it("strips escape sequences and control characters", () => {
    const esc = String.fromCharCode(27);
    const bell = String.fromCharCode(7);
    expect(
      readTerminalTail(
        buffer([`${esc}[31mred${esc}[0m${esc}]0;title${bell} ok${bell}`]),
      ),
    ).toBe("red ok");
  });
});

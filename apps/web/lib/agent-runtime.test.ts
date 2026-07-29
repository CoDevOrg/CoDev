import { describe, expect, it } from "vitest";

import { validateAgentCommand } from "./agent-runtime";

describe("agent command boundary", () => {
  it("allows verification and read-only Git commands", () => {
    expect(validateAgentCommand(["git", "diff", "--", "src"])).toEqual([
      "git",
      "diff",
      "--",
      "src",
    ]);
    expect(validateAgentCommand(["pnpm", "typecheck"])).toEqual([
      "pnpm",
      "typecheck",
    ]);
  });

  it("rejects mutating Git and escaped paths", () => {
    expect(() => validateAgentCommand(["git", "commit", "-am", "x"])).toThrow();
    expect(() => validateAgentCommand(["cat", "../../secret"])).toThrow();
    expect(() => validateAgentCommand(["python", "script.py"])).toThrow();
  });
});

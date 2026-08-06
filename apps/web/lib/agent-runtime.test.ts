import { describe, expect, it } from "vitest";

import { validateAgentCommand } from "./agent-runtime";

describe("agent command boundary", () => {
  it("allows verification and local Git write commands", () => {
    expect(validateAgentCommand(["git", "diff", "--", "src"])).toEqual([
      "git",
      "diff",
      "--",
      "src",
    ]);
    expect(validateAgentCommand(["git", "commit", "-am", "x"])).toEqual([
      "git",
      "commit",
      "-am",
      "x",
    ]);
    expect(
      validateAgentCommand(["git", "checkout", "-b", "agent/feature"]),
    ).toEqual(["git", "checkout", "-b", "agent/feature"]);
    expect(validateAgentCommand(["pnpm", "typecheck"])).toEqual([
      "pnpm",
      "typecheck",
    ]);
  });

  it("rejects remote Git ops with a tool hint", () => {
    expect(() => validateAgentCommand(["git", "pull"])).toThrow(
      /github_sync|github_publish/,
    );
    expect(() => validateAgentCommand(["git", "push"])).toThrow(
      /github_sync|github_publish/,
    );
    expect(() => validateAgentCommand(["git", "fetch"])).toThrow(
      /github_sync|github_publish/,
    );
  });

  it("rejects escaped paths and unknown executables", () => {
    expect(() => validateAgentCommand(["cat", "../../secret"])).toThrow();
    expect(() => validateAgentCommand(["python", "script.py"])).toThrow();
    expect(() =>
      validateAgentCommand(["git", "-C", "/tmp", "status"]),
    ).toThrow();
  });

  it("keeps optional repository search commands inside the boundary", () => {
    expect(validateAgentCommand(["rg", "workspace"])).toEqual([
      "rg",
      "workspace",
    ]);
  });
});

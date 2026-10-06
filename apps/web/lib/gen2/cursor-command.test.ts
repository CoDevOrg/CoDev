import { describe, expect, it } from "vitest";
import { buildGen2CursorCommand } from "./cursor-command";
describe("Cursor workspace command", () => {
  it("uses the ARM CLI in headless mode without credential arguments", () => {
    const command = buildGen2CursorCommand(
      "inspect README",
      [{ role: "user", body: "Earlier request" }],
      "account-model",
    );
    expect(command.slice(0, 8)).toEqual([
      "cursor-agent",
      "--print",
      "--output-format",
      "stream-json",
      "--force",
      "--trust",
      "--model",
      "account-model",
    ]);
    expect(command.at(-1)).toContain("Earlier request");
    expect(command).not.toContain("--api-key");
  });
  it("does not force a hard-coded model when no override is supplied", () => {
    expect(buildGen2CursorCommand("hello")).not.toContain("--model");
  });
});

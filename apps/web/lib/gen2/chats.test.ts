import { describe, expect, it } from "vitest";

import {
  formatGen2TurnPrompt,
  GEN2_NEW_CHAT_TITLE,
  gen2ChatTitleFromPrompt,
} from "./chats-format";

describe("gen2 chat transcript", () => {
  it("titles a chat from the first words of the prompt", () => {
    expect(gen2ChatTitleFromPrompt("  List the files in src  ")).toBe(
      "List the files in src",
    );
    expect(gen2ChatTitleFromPrompt("")).toBe(GEN2_NEW_CHAT_TITLE);
  });

  it("sends prior turns with the next Codex exec instead of resuming a CLI thread", () => {
    expect(formatGen2TurnPrompt("Add tests", [])).toBe("Add tests");
    expect(
      formatGen2TurnPrompt("Add tests", [
        { role: "user", body: "List the files" },
        { role: "assistant", body: "README.md" },
      ]),
    ).toBe(
      [
        "Continue this conversation. Use the previous turns as context.",
        "",
        "Previous conversation on this chat:",
        "User: List the files",
        "Codex: README.md",
        "",
        "Current request:",
        "Add tests",
      ].join("\n"),
    );
  });
});

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

  it("titles a chat from what the member wrote, not the command or tokens", () => {
    expect(
      gen2ChatTitleFromPrompt(
        "/plan Refactor @[auth.ts](file:src%2Fauth.ts) to use hooks",
      ),
    ).toBe("Refactor @auth.ts to use hooks");
    expect(gen2ChatTitleFromPrompt("/review")).toBe("Review");
    expect(gen2ChatTitleFromPrompt("/goal clear")).toBe(GEN2_NEW_CHAT_TITLE);
    expect(gen2ChatTitleFromPrompt("/goal done")).toBe(GEN2_NEW_CHAT_TITLE);
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
        "Assistant: README.md",
        "",
        "Current request:",
        "Add tests",
      ].join("\n"),
    );
  });
});

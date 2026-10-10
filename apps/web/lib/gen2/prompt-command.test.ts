import { describe, expect, it } from "vitest";

import { formatGen2AttachmentPrompt } from "./chat-attachments";
import {
  parseGen2PromptCommand,
  withGen2PromptCommand,
} from "./prompt-command";

describe("gen2 prompt commands", () => {
  it("reads a leading agent command and its text", () => {
    expect(parseGen2PromptCommand("/plan Add a search box")).toEqual({
      command: "plan",
      text: "Add a search box",
      goalControl: null,
    });
    expect(parseGen2PromptCommand("/REVIEW")).toEqual({
      command: "review",
      text: "",
      goalControl: null,
    });
  });

  it("ignores commands that are not first, unknown, or glued to a word", () => {
    for (const prompt of [
      "please /plan this",
      "/planet facts",
      "/deploy now",
      " /plan x",
    ])
      expect(parseGen2PromptCommand(prompt).command).toBeNull();
  });

  it("recognizes goal controls only for /goal", () => {
    expect(parseGen2PromptCommand("/goal clear").goalControl).toBe("clear");
    expect(parseGen2PromptCommand("/goal OFF").goalControl).toBe("clear");
    expect(parseGen2PromptCommand("/goal done").goalControl).toBe("done");
    expect(parseGen2PromptCommand("/goal clear the cache").goalControl).toBe(
      null,
    );
    expect(parseGen2PromptCommand("/ask clear").goalControl).toBeNull();
  });

  it("keeps the command ahead of an attachment header", () => {
    const prompt = withGen2PromptCommand(
      "goal",
      formatGen2AttachmentPrompt([".codev/uploads/spec.md"], "Ship the spec"),
    );
    expect(prompt.startsWith("/goal Attached files on this machine:")).toBe(
      true,
    );
    expect(parseGen2PromptCommand(prompt).command).toBe("goal");
    expect(withGen2PromptCommand(null, "  hi ")).toBe("hi");
    expect(withGen2PromptCommand("init", "")).toBe("/init");
  });
});

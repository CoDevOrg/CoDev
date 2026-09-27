import { describe, expect, it } from "vitest";

import {
  formatGen2AttachmentPrompt,
  gen2ChatUploadPath,
  isNonTextFileContents,
  sanitizeGen2UploadName,
} from "./chat-attachments";

describe("gen2 chat attachments", () => {
  it("sanitizes upload names to a basename under the upload dir", () => {
    expect(sanitizeGen2UploadName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeGen2UploadName("notes.md")).toBe("notes.md");
    expect(gen2ChatUploadPath("My Notes!.md")).toBe(
      ".codev/uploads/My Notes_.md",
    );
  });

  it("detects binary mojibake from File.text()", () => {
    expect(isNonTextFileContents("plain")).toBe(false);
    expect(isNonTextFileContents("bad\uFFFDbytes")).toBe(true);
  });

  it("prefixes the prompt with workspace paths Codex can open", () => {
    expect(
      formatGen2AttachmentPrompt(
        [".codev/uploads/a.ts", ".codev/uploads/b.md"],
        "  fix these  ",
      ),
    ).toBe(
      "Attached files on this machine:\n- `.codev/uploads/a.ts`\n- `.codev/uploads/b.md`\n\nfix these",
    );
    expect(formatGen2AttachmentPrompt([".codev/uploads/a.ts"], "")).toBe(
      "Attached files on this machine:\n- `.codev/uploads/a.ts`\n\nPlease inspect these files.",
    );
    expect(formatGen2AttachmentPrompt([], "hello")).toBe("hello");
  });
});

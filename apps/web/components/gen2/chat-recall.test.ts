import { describe, expect, it } from "vitest";

import { recallableChatText } from "./chat-recall";

describe("recallableChatText", () => {
  it("keeps the command and mention tokens", () => {
    expect(recallableChatText("/plan fix @[a.ts](file:a.ts)")).toBe(
      "/plan fix @[a.ts](file:a.ts)",
    );
  });

  it("drops the attachment list the composer added", () => {
    const body =
      "/review Attached files on this machine:\n- `.codev/uploads/a.ts`\n- `.codev/uploads/b.ts`\n\nfocus on auth";
    expect(recallableChatText(body)).toBe("/review focus on auth");
    expect(
      recallableChatText(
        "Attached files on this machine:\n- `.codev/uploads/a.ts`\n\nPlease inspect these files.",
      ),
    ).toBe("");
  });

  it("leaves a plain message alone", () => {
    expect(recallableChatText("Please inspect these files.")).toBe(
      "Please inspect these files.",
    );
  });
});

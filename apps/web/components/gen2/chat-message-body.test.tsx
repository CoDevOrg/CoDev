import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatMessageBody } from "./chat-message-body";

describe("ChatMessageBody", () => {
  it("shows the mode as a chip and mentions as @labels", () => {
    const { container } = render(
      <ChatMessageBody body="/plan fix @[api.ts](file:src%2Fapi.ts) and @[api.ts](file:src%2Fapi.ts) again" />,
    );
    expect(screen.getByText("Plan")).toHaveClass("gen2-chat-mode");
    const mention = screen.getAllByText("@api.ts")[0]!;
    expect(mention).toHaveClass("gen2-chat-mention");
    expect(mention).toHaveAttribute("title", "src/api.ts");
    expect(container.querySelector("p")).toHaveTextContent(
      "fix @api.ts and @api.ts again",
    );
    expect(container.textContent).not.toContain("](");
  });

  it("renders a plain message as it was written", () => {
    const { container } = render(
      <ChatMessageBody body={"line one\n/plan not a command"} />,
    );
    expect(container.querySelector(".gen2-chat-mode")).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe(
      "line one\n/plan not a command",
    );
  });
});

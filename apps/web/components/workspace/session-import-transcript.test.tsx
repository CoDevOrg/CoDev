import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionImportTranscript } from "./session-import-transcript";

describe("imported session transcript", () => {
  it("keeps source order visible when a user message contains long prompt context", () => {
    const longPrompt = `${"Context ".repeat(400)}\nPlease fix message order`;
    render(
      <SessionImportTranscript
        provider="codex"
        entries={[
          {
            sequence: 0,
            role: "user",
            authorName: null,
            text: longPrompt,
            createdAt: null,
          },
          {
            sequence: 1,
            role: "assistant",
            authorName: null,
            text: "I will inspect the rollout.",
            createdAt: null,
          },
          {
            sequence: 2,
            role: "user",
            authorName: null,
            text: "Thank you.",
            createdAt: null,
          },
        ]}
      />,
    );

    const messages = within(
      screen.getByRole("list", { name: "Session messages" }),
    ).getAllByRole("listitem");
    expect(messages).toHaveLength(3);
    expect(messages[0]).toHaveTextContent("Imported contextSource prompt");
    expect(messages[1]).toHaveTextContent("CodexMessage 2");
    expect(messages[2]).toHaveTextContent("YouMessage 3");
    expect(messages[0]).toHaveTextContent("Please fix message order");

    const disclosure = within(messages[0]!)
      .getByText(/Context bundle/)
      .closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    fireEvent.click(within(messages[0]!).getByText(/Context bundle/));
    expect(disclosure).toHaveAttribute("open");
  });
});

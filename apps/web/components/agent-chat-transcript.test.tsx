import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentChatTranscript } from "./agent-chat-transcript";

describe("AgentChatTranscript", () => {
  it("renders common agent Markdown instead of showing formatting markers", () => {
    const { container } = render(
      <AgentChatTranscript
        items={[
          {
            kind: "assistant",
            id: "assistant-1",
            text: "**Outcome:**\n\n- Reviewed the files\n- **No changes**\n\n```sh\nrg --version\n```",
          },
        ]}
      />,
    );

    expect(screen.getByText("Outcome:").tagName).toBe("STRONG");
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("No changes").tagName).toBe("STRONG");
    expect(container.querySelector("pre code")?.textContent).toBe(
      "rg --version",
    );
    expect(container.textContent).not.toContain("**");
  });
});

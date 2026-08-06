import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
            turnId: "turn-1",
            tokens: {
              inputTokens: 100,
              outputTokens: 40,
              totalTokens: 140,
            },
            tokensEstimated: false,
          },
        ]}
        canBranch
        onBranchFromReply={vi.fn()}
      />,
    );

    expect(screen.getByText("Agent Reply")).toBeInTheDocument();
    expect(screen.getByText("140 tokens")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Branch here/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Outcome:").tagName).toBe("STRONG");
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("No changes").tagName).toBe("STRONG");
    expect(container.querySelector("pre code")?.textContent).toBe(
      "rg --version",
    );
    expect(container.textContent).not.toContain("**");
  });
});

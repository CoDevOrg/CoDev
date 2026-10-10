import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  SupersetAgentSessionsPanel,
  type SupersetAgentSession,
} from "./superset-agent-sessions-panel";

const run = (
  overrides: Partial<SupersetAgentSession>,
): SupersetAgentSession => ({
  id: "r1",
  chatId: "chat-other",
  createdBy: "u1",
  worktreeId: "feature-x",
  provider: "anthropic",
  status: "running",
  updatedAt: "2026-10-08T00:00:00Z",
  ...overrides,
});

function renderPanel(runs: SupersetAgentSession[]) {
  const props = {
    chatTitle: (id: string) => (id === "chat-other" ? "Fix login" : null),
    branchFor: (id: string) => `branch-of-${id}`,
    currentChatId: "chat-open",
    canEdit: true,
    onOpen: vi.fn(),
    onStop: vi.fn(),
    stoppingRunId: null,
  };
  return {
    props,
    ...render(<SupersetAgentSessionsPanel {...props} runs={runs} />),
  };
}

describe("SupersetAgentSessionsPanel", () => {
  it("takes no space without an agent working in another chat", () => {
    const { container } = renderPanel([
      run({ status: "finished" }),
      run({ id: "r2", chatId: "chat-open" }),
    ]);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the agent, chat, branch and status, and opens that chat", () => {
    const { props } = renderPanel([run({})]);
    const open = screen.getByRole("button", {
      name: "Claude working on Fix login in branch-of-feature-x. Open it.",
    });
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.queryByText("anthropic")).not.toBeInTheDocument();
    fireEvent.click(open);
    expect(props.onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1", chatId: "chat-other" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Stop the agent on Fix login" }),
    );
    expect(props.onStop).toHaveBeenCalledWith("r1");
  });
});

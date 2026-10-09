import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SupersetAgentSessionsPanel } from "./superset-agent-sessions-panel";

const props = {
  canEdit: true,
  onSelect: vi.fn(),
  onStop: vi.fn(),
  stoppingRunId: null,
};

describe("SupersetAgentSessionsPanel", () => {
  it("takes no space until an agent session exists", () => {
    const { container } = render(
      <SupersetAgentSessionsPanel {...props} runs={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists running sessions", () => {
    render(
      <SupersetAgentSessionsPanel
        {...props}
        runs={[
          {
            id: "r1",
            createdBy: "u1",
            worktreeId: "feature-x",
            provider: "codex",
            status: "running",
            updatedAt: "2026-10-08T00:00:00Z",
          },
        ]}
      />,
    );
    expect(screen.getByText("Agent sessions")).toBeInTheDocument();
    expect(screen.getByText("feature-x")).toBeInTheDocument();
  });
});

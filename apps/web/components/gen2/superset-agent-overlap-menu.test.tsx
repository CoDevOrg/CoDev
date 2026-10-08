import { fireEvent, render, screen } from "@testing-library/react";
import type { Gen2AgentOverlap } from "@codev/contracts";
import { describe, expect, it, vi } from "vitest";

import { SupersetAgentOverlapMenu } from "./superset-agent-overlap-menu";
import {
  deriveCardColumn,
  SupersetWorkspacesBoard,
} from "./superset-workspaces-board";

const RUN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SARA = "33333333-3333-4333-8333-333333333333";

function overlap(path: string, symbols: string[] = []): Gen2AgentOverlap {
  return {
    runId: RUN,
    otherRunId: OTHER,
    otherWorktreeId: "fix-auth",
    otherProvider: "claude",
    otherCreatedBy: SARA,
    path,
    level: symbols.length > 0 ? "function" : "file",
    symbols,
  };
}

function openMenu(overlaps: Gen2AgentOverlap[], onOpenWorktree = vi.fn()) {
  render(
    <SupersetAgentOverlapMenu
      overlaps={overlaps}
      branchFor={(id) => `branch/${id}`}
      memberLabel={(id) => (id === SARA ? "Sara" : "a member")}
      onOpenWorktree={onOpenWorktree}
    />,
  );
  const trigger = screen.getByRole("button", {
    name: /overlap with other agents/,
  });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return trigger;
}

describe("SupersetAgentOverlapMenu", () => {
  it("renders nothing without overlaps", () => {
    const { container } = render(
      <SupersetAgentOverlapMenu
        overlaps={[]}
        branchFor={(id) => id}
        memberLabel={() => "a member"}
        onOpenWorktree={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names the other agent, its files and functions, and opens its branch", () => {
    const onOpenWorktree = vi.fn();
    const trigger = openMenu(
      [overlap("src/auth.ts", ["refreshToken"]), overlap("README.md")],
      onOpenWorktree,
    );

    expect(trigger).toHaveAccessibleName("2 files overlap with other agents");
    expect(screen.getByText("branch/fix-auth")).toBeInTheDocument();
    expect(screen.getByText(/claude · Sara/)).toBeInTheDocument();
    expect(screen.getByText("refreshToken()")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Open branch" }));
    expect(onOpenWorktree).toHaveBeenCalledWith("fix-auth");
  });

  it("lists five paths per agent and counts the rest", () => {
    openMenu(Array.from({ length: 7 }, (_, index) => overlap(`f${index}.ts`)));

    expect(screen.getByText("f4.ts")).toBeInTheDocument();
    expect(screen.queryByText("f5.ts")).not.toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });
});

describe("board overlap line", () => {
  it("shows overlapping branches without moving the card to attention", () => {
    const item = {
      worktreeId: "rate-limit",
      branch: "rate-limit",
      fileCount: 2,
      changesKnown: true,
      agentStatus: "working" as const,
      overlap: { branches: ["fix-auth", "docs"], files: 2 },
    };
    render(
      <SupersetWorkspacesBoard
        items={[item]}
        selectedWorktreeId="rate-limit"
        onSelectWorktree={vi.fn()}
        canEdit
      />,
    );

    expect(deriveCardColumn(item)).toBe("working");
    expect(
      screen.getByText("Overlaps fix-auth +1 more · 2 files"),
    ).toBeInTheDocument();
  });
});

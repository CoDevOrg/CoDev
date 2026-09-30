import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  deriveCardColumn,
  SupersetWorkspacesBoard,
  type BoardWorktreeItem,
} from "./superset-workspaces-board";

describe("deriveCardColumn", () => {
  it("routes working agents to working column", () => {
    expect(
      deriveCardColumn({
        worktreeId: "wt-1",
        branch: "feat/1",
        fileCount: 0,
        agentStatus: "working",
      }),
    ).toBe("working");
  });

  it("routes errors and attention status to attention column", () => {
    expect(
      deriveCardColumn({
        worktreeId: "wt-2",
        branch: "feat/2",
        fileCount: 0,
        agentStatus: "attention",
      }),
    ).toBe("attention");

    expect(
      deriveCardColumn({
        worktreeId: "wt-3",
        branch: "feat/3",
        fileCount: 0,
        agentError: "Process killed",
      }),
    ).toBe("attention");
  });

  it("routes uncommitted changes to review column", () => {
    expect(
      deriveCardColumn({
        worktreeId: "wt-4",
        branch: "feat/4",
        fileCount: 3,
      }),
    ).toBe("review");
  });

  it("routes clean checkouts to idle column", () => {
    expect(
      deriveCardColumn({
        worktreeId: "main",
        branch: "main",
        fileCount: 0,
      }),
    ).toBe("idle");
  });

  it("routes merged branches to merged column", () => {
    expect(
      deriveCardColumn({
        worktreeId: "wt-old",
        branch: "done",
        fileCount: 0,
        agentStatus: "merged",
      }),
    ).toBe("merged");
  });
});

describe("SupersetWorkspacesBoard component", () => {
  const sampleItems: BoardWorktreeItem[] = [
    {
      worktreeId: "main",
      branch: "main",
      fileCount: 0,
      agentStatus: "idle",
    },
    {
      worktreeId: "feature-auth",
      branch: "feature/auth",
      fileCount: 2,
      agentStatus: "review",
    },
    {
      worktreeId: "fix-login",
      branch: "fix/login",
      fileCount: 1,
      agentStatus: "working",
      agentProvider: "codex",
    },
    {
      worktreeId: "bug-crash",
      branch: "bug/crash",
      fileCount: 0,
      agentStatus: "attention",
      agentError: "Lease timeout",
    },
  ];

  it("renders all 5 columns with proper card placement", () => {
    render(
      <SupersetWorkspacesBoard
        items={sampleItems}
        selectedWorktreeId="main"
        onSelectWorktree={vi.fn()}
        canEdit
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Working" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Needs Attention" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Needs Review" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Idle" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Merged" })).toBeInTheDocument();

    expect(screen.getByText("fix/login")).toBeInTheDocument();
    expect(screen.getByText("feature/auth")).toBeInTheDocument();
    expect(screen.getByText("bug/crash")).toBeInTheDocument();
    expect(screen.getAllByText("main").length).toBeGreaterThanOrEqual(1);
  });

  it("filters cards by query", () => {
    render(
      <SupersetWorkspacesBoard
        items={sampleItems}
        selectedWorktreeId="main"
        onSelectWorktree={vi.fn()}
        canEdit
      />,
    );

    const input = screen.getByLabelText("Filter branches");
    fireEvent.change(input, { target: { value: "auth" } });

    expect(screen.getByText("feature/auth")).toBeInTheDocument();
    expect(screen.queryByText("fix/login")).not.toBeInTheDocument();
    expect(screen.queryByText("bug/crash")).not.toBeInTheDocument();
  });

  it("calls onSelectWorktree when card or buttons are clicked", () => {
    const onSelect = vi.fn();
    render(
      <SupersetWorkspacesBoard
        items={sampleItems}
        selectedWorktreeId="main"
        onSelectWorktree={onSelect}
        canEdit
      />,
    );

    fireEvent.click(screen.getByText("feature/auth"));
    expect(onSelect).toHaveBeenCalledWith("feature-auth", false);

    const promptButtons = screen.getAllByRole("button", { name: /prompt/i });
    expect(promptButtons.length).toBeGreaterThan(0);
    fireEvent.click(promptButtons[0]!);
    expect(onSelect).toHaveBeenCalledWith(expect.any(String), true);
  });
});

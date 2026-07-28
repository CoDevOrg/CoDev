import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { demoAgents, demoCode, demoFiles, terminalLines } from "@/lib/fixtures";

import { WorkspaceShell } from "./workspace-shell";

const renderShell = () =>
  render(
    <WorkspaceShell
      agents={demoAgents}
      code={demoCode}
      files={demoFiles}
      terminalLines={terminalLines}
    />,
  );

describe("WorkspaceShell", () => {
  it("labels fixture-only and disconnected states", () => {
    renderShell();

    expect(screen.getByText("Demo shell")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(
      screen.getByText("Terminal unavailable in demo shell"),
    ).toBeInTheDocument();
  });

  it("switches worktrees and collapses the explorer", () => {
    const { container } = renderShell();

    fireEvent.change(screen.getByLabelText("Active worktree"), {
      target: { value: "atlas" },
    });
    expect(screen.getByLabelText("Active worktree")).toHaveValue("atlas");

    fireEvent.click(screen.getByLabelText("Toggle file explorer"));
    expect(container.querySelector(".workspace-grid")).toHaveClass(
      "left-collapsed",
    );
  });
});

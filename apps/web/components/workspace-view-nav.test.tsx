import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceViewNav } from "./workspace-view-nav";

describe("WorkspaceViewNav", () => {
  it("renders the primary workspace views and selects a view", () => {
    const onSelect = vi.fn();

    render(
      <WorkspaceViewNav activeView="chat" hasPreview onSelect={onSelect} />,
    );

    expect(
      screen.getByRole("button", { name: "Agent Console" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Code & Diffs" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Team Stats" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Web Workspace" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Team Stats" }));
    expect(onSelect).toHaveBeenCalledWith("stats");
  });

  it("disables Web Workspace until a preview is available", () => {
    render(
      <WorkspaceViewNav
        activeView="chat"
        hasPreview={false}
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Web Workspace" }),
    ).toBeDisabled();
  });
});

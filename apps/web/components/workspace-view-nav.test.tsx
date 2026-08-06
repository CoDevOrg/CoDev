import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceViewNav } from "./workspace-view-nav";

describe("WorkspaceViewNav", () => {
  it("renders the primary workspace views and selects a view", () => {
    const onSelect = vi.fn();

    render(<WorkspaceViewNav activeView="chat" onSelect={onSelect} />);

    expect(
      screen.getByRole("button", { name: "Agent Console" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Code & Diffs" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Team Stats" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Web Workspace" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Team Stats" }));
    expect(onSelect).toHaveBeenCalledWith("stats");
  });

  it("keeps Web Workspace selectable without a preview entry", () => {
    const onSelect = vi.fn();

    render(<WorkspaceViewNav activeView="chat" onSelect={onSelect} />);

    const preview = screen.getByRole("button", { name: "Web Workspace" });
    expect(preview).toBeEnabled();
    fireEvent.click(preview);
    expect(onSelect).toHaveBeenCalledWith("preview");
  });
});

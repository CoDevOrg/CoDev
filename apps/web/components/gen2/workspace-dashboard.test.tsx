import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import type { Gen2Workspace } from "@codev/contracts";
import { Gen2WorkspaceDashboard } from "./workspace-dashboard";

const mockWorkspace: Gen2Workspace = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Design System",
  repository: {
    fullName: "codev/design",
    private: false,
    defaultBranch: "main",
  },
  status: "ready",
  sandboxId: "sandbox-2",
  lastError: null,
  role: "owner",
  createdAt: "2026-09-21T12:00:00.000Z",
  updatedAt: "2026-09-21T12:00:00.000Z",
};

describe("Gen2WorkspaceDashboard", () => {
  it("renders header greeting, eyebrow, and stats correctly", () => {
    render(
      <Gen2WorkspaceDashboard
        user={{ id: "u-1", name: "Yousef Maher" }}
        github={{ connected: true, login: "yousef20920" }}
        initialWorkspaces={[mockWorkspace]}
      />,
    );

    expect(screen.getByText("WORKSPACE HOME")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /yousef/i,
    );
    expect(
      screen.getByText("Build together with people and AI agents."),
    ).toBeInTheDocument();

    // Stats
    expect(screen.getByText("Workspaces")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("@yousef20920")).toBeInTheDocument();
  });

  it("filters workspaces using search and filter pills", () => {
    render(
      <Gen2WorkspaceDashboard
        user={{ id: "u-1", name: "Yousef" }}
        github={{ connected: true, login: "yousef20920" }}
        initialWorkspaces={[mockWorkspace]}
      />,
    );

    expect(screen.getByText("Design System")).toBeInTheDocument();

    // Search filter
    const searchInput = screen.getByLabelText("Search workspaces");
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });
    expect(screen.queryByText("Design System")).toBeNull();

    fireEvent.change(searchInput, { target: { value: "Design" } });
    expect(screen.getByText("Design System")).toBeInTheDocument();

    // Tab filter
    fireEvent.click(screen.getByRole("tab", { name: "Shared" }));
    expect(screen.queryByText("Design System")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Owned" }));
    expect(screen.getByText("Design System")).toBeInTheDocument();
  });

  it("opens create workspace dialog when clicking New workspace card", () => {
    render(
      <Gen2WorkspaceDashboard
        user={{ id: "u-1", name: "Yousef" }}
        github={{ connected: false, login: null }}
        initialWorkspaces={[]}
      />,
    );

    const newCard = screen.getByLabelText("New workspace");
    expect(newCard).toBeInTheDocument();
    fireEvent.click(newCard);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "New workspace" }),
    ).toBeInTheDocument();
  });
});

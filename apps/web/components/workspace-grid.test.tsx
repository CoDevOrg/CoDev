import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceGrid } from "./workspace-grid";

vi.mock("./repository-picker", () => ({
  RepositoryPicker: () => null,
}));

describe("WorkspaceGrid", () => {
  it("links each workspace card to its Orca workspace route", () => {
    render(
      <WorkspaceGrid
        appSlug={undefined}
        workspaces={[
          {
            id: "workspace-1",
            repository: "yousef20920/CoDev",
            repositoryVisibility: "private",
            defaultBranch: "main",
            baseSha: "1234567890abcdef",
            status: "ready",
            role: "owner",
            updatedAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    expect(screen.getByText("yousef20920/CoDev")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open yousef20920/CoDev" }),
    ).toHaveAttribute("href", "/workspaces/workspace-1");
  });

  it("does not render a removed workspace frontend resume action", () => {
    const { container } = render(
      <WorkspaceGrid
        appSlug={undefined}
        workspaces={[
          {
            id: "workspace-1",
            repository: "yousef20920/CoDev",
            repositoryVisibility: "private",
            defaultBranch: "main",
            baseSha: "1234567890abcdef",
            status: "failed",
            role: "owner",
            updatedAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    expect(container.querySelector(".resume-primary-button")).toBeNull();
  });

  it("shows active collaborators instead of a synthetic workspace preview", () => {
    const { container } = render(
      <WorkspaceGrid
        appSlug={undefined}
        workspaces={[
          {
            id: "workspace-1",
            repository: "yousef20920/CoDev",
            repositoryVisibility: "private",
            defaultBranch: "main",
            baseSha: "1234567890abcdef",
            status: "ready",
            role: "owner",
            updatedAt: new Date().toISOString(),
            liveCollaborators: [
              {
                id: "user-1",
                login: "yousef",
                name: "Yousef Abdelhadi",
                avatarUrl: "https://example.com/yousef.png",
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("1 collaborator live now")).toBeVisible();
    expect(
      screen.getByRole("img", { name: "Yousef Abdelhadi" }),
    ).toHaveAttribute("src", "https://example.com/yousef.png");
    expect(container.querySelector(".workspace-card-icon")).toBeNull();
  });

  it("states when a workspace has no one active instead of showing a preview", () => {
    render(
      <WorkspaceGrid
        appSlug={undefined}
        workspaces={[
          {
            id: "workspace-1",
            repository: "yousef20920/CoDev",
            repositoryVisibility: "private",
            defaultBranch: "main",
            baseSha: "1234567890abcdef",
            status: "ready",
            role: "owner",
            updatedAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    expect(screen.getByText("No one is active right now")).toBeVisible();
  });
});

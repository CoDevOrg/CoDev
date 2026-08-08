import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceGrid } from "./workspace-grid";

vi.mock("./repository-picker", () => ({
  RepositoryPicker: () => null,
}));

describe("WorkspaceGrid", () => {
  it("lists persisted workspaces without coupling them to a frontend route", () => {
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
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
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
});

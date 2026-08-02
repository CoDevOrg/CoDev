import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceGrid } from "./workspace-grid";

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a>,
}));

vi.mock("./repository-picker", () => ({
  RepositoryPicker: () => null,
}));

describe("WorkspaceGrid", () => {
  it("opens a workspace directly in the IDE", () => {
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

    expect(
      screen.getByRole("link", { name: /yousef20920\/CoDev/ }),
    ).toHaveAttribute("href", "/workspaces/workspace-1/ide");
  });
});

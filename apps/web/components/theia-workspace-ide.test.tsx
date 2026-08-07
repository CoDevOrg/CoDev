import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TheiaWorkspaceIde } from "./theia-workspace-ide";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";

describe("TheiaWorkspaceIde", () => {
  it("gives the entire workspace page to the Theia workbench", () => {
    const { container } = render(
      <TheiaWorkspaceIde workspaceId={workspaceId} canEdit />,
    );

    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("aside")).toBeNull();
    expect(screen.getByTitle("CoDev Eclipse Theia workspace")).toHaveAttribute(
      "src",
      `/theia/index.html?workspaceId=${workspaceId}`,
    );
  });

  it("does not open the editable workbench for a viewer", () => {
    render(<TheiaWorkspaceIde workspaceId={workspaceId} canEdit={false} />);

    expect(screen.queryByTitle("CoDev Eclipse Theia workspace")).toBeNull();
    expect(screen.getByText("Editor access required")).toBeInTheDocument();
  });
});

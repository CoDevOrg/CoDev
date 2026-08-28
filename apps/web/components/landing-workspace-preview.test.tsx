import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkspacePreview } from "./landing-workspace-preview";

describe("WorkspacePreview", () => {
  it("keeps the hero preview focused on the essential shared-work story", () => {
    render(<WorkspacePreview />);

    expect(
      screen.getByRole("heading", {
        name: "Payments incident",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Checking production logs")).toBeInTheDocument();
    expect(screen.getByText("Investigating DB saturation")).toBeInTheDocument();
    expect(screen.getByText("Reviewing rollback")).toBeInTheDocument();
    expect(screen.getByText("SHARED FINDINGS")).toBeInTheDocument();
    expect(
      screen.getByText("Prepare rollback. Do not execute yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Three people and three agents online"),
    ).toBeInTheDocument();

    expect(screen.queryByText("Investigations")).not.toBeInTheDocument();
    expect(screen.queryByText("Room context")).not.toBeInTheDocument();
    expect(screen.queryByText("Artifacts")).not.toBeInTheDocument();
  });
});

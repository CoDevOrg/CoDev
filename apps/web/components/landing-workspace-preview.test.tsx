import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkspacePreview } from "./landing-workspace-preview";

describe("WorkspacePreview", () => {
  it("shows the shared room, its live feed, and the share menu", () => {
    render(<WorkspacePreview />);

    expect(screen.getByText("Refund policy rewrite")).toBeInTheDocument();
    expect(screen.getByText("A room · 3 people · 1 AI")).toBeInTheDocument();

    // The feed renders every event for SSR / no-JS / reduced motion.
    expect(
      screen.getByText("Rewrite this so a customer can understand it"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Drafted a shorter version — 3 clauses cut"),
    ).toBeInTheDocument();
    expect(screen.getByText("Joined and read the room")).toBeInTheDocument();

    // The share moment.
    expect(screen.getByText("Share this room")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByLabelText("Link access")).toBeInTheDocument();
  });
});

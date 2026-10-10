import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkspaceHomeSkeleton } from "./workspace-home-skeleton";

describe("WorkspaceHomeSkeleton", () => {
  it("announces loading once and hides the placeholder layout", () => {
    const { container } = render(<WorkspaceHomeSkeleton />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading workspaces…");
    expect(container.querySelector("main")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(container.querySelector(".gen2-home-skeleton")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("uses the dashboard's own layout: four stat tiles, a toolbar, and cards", () => {
    const { container } = render(<WorkspaceHomeSkeleton />);

    expect(container.querySelectorAll(".gen2-stats .gen2-stat")).toHaveLength(
      4,
    );
    expect(container.querySelectorAll(".gen2-stat-meter")).toHaveLength(2);
    expect(container.querySelector(".gen2-toolbar")).not.toBeNull();
    expect(container.querySelector(".gen2-grid .gen2-new-card")).not.toBeNull();
    expect(container.querySelectorAll(".gen2-grid .gen2-ws")).toHaveLength(5);
  });
});

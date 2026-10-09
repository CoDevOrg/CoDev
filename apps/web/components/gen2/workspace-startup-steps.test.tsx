import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceStartupSteps } from "./workspace-startup-steps";

describe("WorkspaceStartupSteps", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("marks earlier steps done and the current step active", () => {
    render(<WorkspaceStartupSteps progress="attaching_disk" />);
    const steps = screen.getByRole("list", { name: "Startup progress" });
    expect(steps.querySelectorAll(".is-done")).toHaveLength(3);
    expect(screen.getByText("Attaching your saved files")).toHaveAttribute(
      "aria-current",
      "step",
    );
  });

  it("treats a ready row as the final live check and counts elapsed time", () => {
    render(<WorkspaceStartupSteps progress="ready" />);
    expect(screen.getByText("Checking the connection")).toHaveAttribute(
      "aria-current",
      "step",
    );
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByText(/^1:05 ·/)).toBeInTheDocument();
  });

  it("shows only elapsed time before a startup step is known", () => {
    render(<WorkspaceStartupSteps progress={null} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText(/^0:00 ·/)).toBeInTheDocument();
  });
});

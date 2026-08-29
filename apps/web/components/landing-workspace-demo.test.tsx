import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LandingWorkspaceDemo } from "./landing-workspace-demo";

function mockReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("LandingWorkspaceDemo", () => {
  beforeEach(() => {
    mockReducedMotion(false);
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: vi.fn(() => 1),
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("lets a visitor inspect every deterministic phase", () => {
    const { container } = render(<LandingWorkspaceDemo />);

    fireEvent.click(screen.getByRole("button", { name: "Write" }));
    expect(screen.getByRole("button", { name: "Write" })).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(
      screen.getByText(/hand off through the workspace brain/i),
    ).toBeVisible();
    expect(container).toHaveTextContent("reserveSchema.parse(input)");
    expect(container).toHaveTextContent(
      "Codex pushed it, Claude picked up session.ts",
    );

    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    expect(screen.getByRole("button", { name: "Ready" })).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByLabelText("Live agents")).toHaveTextContent(
      "Ready for review",
    );
    expect(screen.getByLabelText("Completed file")).toHaveTextContent(
      "audit.record",
    );
  });

  it("renders the completed state without timed motion when requested", async () => {
    mockReducedMotion(true);
    render(<LandingWorkspaceDemo />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ready" })).toHaveAttribute(
        "aria-current",
        "step",
      ),
    );
    expect(screen.getByRole("button", { name: "Play demo" })).toBeDisabled();
    expect(screen.getByText(/ready for a person to review/i)).toBeVisible();
  });
});

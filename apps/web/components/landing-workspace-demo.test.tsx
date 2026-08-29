import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeAgentsForElapsed,
  activeFileForElapsed,
  LandingWorkspaceDemo,
} from "./landing-workspace-demo";

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
    expect(screen.getByText(/sorted it out between themselves/i)).toBeVisible();
    expect(container).toHaveTextContent("reserveSchema.parse(input)");
    expect(screen.getByLabelText("Agents coordinating")).toBeVisible();
    expect(screen.getByText(/peer to peer/i)).toBeVisible();
    expect(container).toHaveTextContent("Cursor fixes it once");
    expect(
      screen.getByLabelText("Codex, Claude, Cursor typing simultaneously"),
    ).toBeVisible();

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

  it("gives every agent a deterministic typing turn", () => {
    expect(activeFileForElapsed(6_000).agent.name).toBe("Codex");
    expect(activeFileForElapsed(15_000).agent.name).toBe("Claude");
    expect(activeFileForElapsed(23_000).agent.name).toBe("Cursor");
  });

  it("shows all three agents typing concurrently during Write", () => {
    expect(
      activeAgentsForElapsed(5_500).map(({ name, tone }) => ({ name, tone })),
    ).toEqual([
      { name: "Codex", tone: "orange" },
      { name: "Claude", tone: "green" },
      { name: "Cursor", tone: "purple" },
    ]);
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

  it("shows the detailed sharing panel during the Join sequence", () => {
    render(<LandingWorkspaceDemo initialElapsed={1_000} />);

    const sharePanel = screen.getByRole("note", {
      name: "Share acme storefront workspace",
    });
    expect(sharePanel).toHaveTextContent("Add people, groups, or teams");
    expect(sharePanel).toHaveTextContent("People with access");
    expect(sharePanel).toHaveTextContent("Alex Morgan (you)");
    expect(sharePanel).toHaveTextContent("General access");
    expect(sharePanel).toHaveTextContent("Restricted");
    expect(sharePanel).toHaveTextContent("Copy link");
    expect(sharePanel).toHaveTextContent("Done");
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LandingLiveDemo } from "./landing-live-demo";

describe("LandingLiveDemo", () => {
  it("shows two people directing Codex and Claude in one shared workspace", () => {
    const { container } = render(<LandingLiveDemo />);

    expect(
      screen.getByRole("region", {
        name: /live codev workspace with codex and claude working in parallel/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Yousef")).toBeInTheDocument();
    expect(screen.getByText("Maya")).toBeInTheDocument();
    expect(screen.getByText(/Codex and Claude are typing/)).toBeInTheDocument();
    expect(
      screen.getByText("One repository. Shared context. No duplicate work."),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("[data-agent]")).toHaveLength(2);
    expect(container.querySelector('[data-agent="codex"]')).not.toBeNull();
    expect(container.querySelector('[data-agent="claude"]')).not.toBeNull();
  });

  it("keeps both agent responses available as real text", () => {
    render(<LandingLiveDemo />);

    expect(screen.getByText(/I found the shared parser/)).toBeInTheDocument();
    expect(screen.getByText(/The sync path is clear/)).toBeInTheDocument();
  });
});

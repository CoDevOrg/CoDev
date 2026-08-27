import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LandingAudience } from "./landing-audience";

describe("LandingAudience", () => {
  it("switches between individual and company benefits", () => {
    render(<LandingAudience />);

    expect(
      screen.getByRole("heading", {
        name: /Share the work, not just the output/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Work side by side")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Companies/ }));

    expect(
      screen.getByRole("heading", {
        name: /Make consequential AI work accountable/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Clear ownership")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Companies/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

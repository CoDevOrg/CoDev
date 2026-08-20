import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LandingAudience } from "./landing-audience";

describe("LandingAudience", () => {
  it("switches between builder and company benefits", () => {
    render(<LandingAudience />);

    expect(
      screen.getByRole("heading", { name: /Build the idea together/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Share the whole workspace")).toBeInTheDocument();
    expect(
      screen.queryByText("A room for every engineering task"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Companies/ }));

    expect(
      screen.getByRole("heading", { name: /Make AI work visible/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Prevent duplicate work")).not.toHaveLength(0);
    expect(
      screen.getByText("A room for every engineering task"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /whole team shares the room/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Companies/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

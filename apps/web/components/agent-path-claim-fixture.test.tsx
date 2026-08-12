import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentPathClaimFixture } from "./agent-path-claim-fixture";

describe("AgentPathClaimFixture", () => {
  it("blocks the write until the exact path is claimed", () => {
    render(<AgentPathClaimFixture />);

    expect(
      screen.getByRole("button", { name: "Write README.md" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "agent write is blocked",
    );

    fireEvent.click(screen.getByRole("button", { name: "Start agent claim" }));

    expect(screen.getByText("README.md", { exact: true })).toBeVisible();
    expect(screen.getByText("fixture-r1", { exact: true })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Write README.md" }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Write README.md" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Agent write accepted for README.md.",
    );
  });
});

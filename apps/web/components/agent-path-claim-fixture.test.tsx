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

  it("surfaces an overlap and supports reassigning the claim", () => {
    render(<AgentPathClaimFixture />);

    fireEvent.click(screen.getByRole("button", { name: "Start agent claim" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Request overlapping claim" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Contested overlap · no silent overwrite",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reassign or cancel before either agent writes.",
    );
    expect(
      screen.getByRole("button", { name: "Write README.md" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Reassign to slot 2" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Claim reassigned to Agent slot 2",
    );
    expect(
      screen.getByText("README.md · Active", { exact: true }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Write README.md" }),
    ).toBeDisabled();
  });

  it("supports cancelling an overlap without changing the active claim", () => {
    render(<AgentPathClaimFixture />);

    fireEvent.click(screen.getByRole("button", { name: "Start agent claim" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Request overlapping claim" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel overlapping claim" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Overlapping claim cancelled",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Agent slot 1 keeps README.md",
    );
    expect(
      screen.getByRole("button", { name: "Write README.md" }),
    ).toBeEnabled();
  });

  it("releases the claim and preserves a checkpoint when the agent stops", () => {
    render(<AgentPathClaimFixture />);

    fireEvent.click(screen.getByRole("button", { name: "Start agent claim" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop agent" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Agent stopped safely",
    );
    expect(screen.getByRole("status")).toHaveTextContent("claim is released");
    expect(screen.getByLabelText("Preserved checkpoint")).toHaveTextContent(
      "README.md · fixture-r1",
    );
    expect(screen.getByLabelText("Preserved checkpoint")).toHaveTextContent(
      "Stopped by Alex Morgan before the next write.",
    );
    expect(
      screen.queryByRole("button", { name: "Stop agent" }),
    ).not.toBeInTheDocument();
  });
});

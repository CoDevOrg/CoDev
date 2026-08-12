import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentReviewCheckpointFixture } from "./agent-review-checkpoint-fixture";

describe("AgentReviewCheckpointFixture", () => {
  it("prepares one immutable checkpoint with revision and diff metadata", () => {
    render(<AgentReviewCheckpointFixture />);

    expect(
      screen.getByRole("button", { name: "Mark review-ready" }),
    ).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "No review checkpoint prepared yet.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark review-ready" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Review ready · immutable checkpoint",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Further writes must create a new checkpoint.",
    );
    expect(screen.getByText("fixture-main-r1", { exact: true })).toBeVisible();
    expect(screen.getByText("fixture-agent-r2", { exact: true })).toBeVisible();
    expect(
      screen.getByText(
        "sha256:3f7a2c8d9b1e4f605a7c9d2e8b6f104c3d5e7a9b1c2d4f608e9a7b5c3d1f2e4",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Checkpoint prepared" }),
    ).toBeDisabled();
  });
});

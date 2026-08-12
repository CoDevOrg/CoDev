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
    expect(
      screen.getAllByText("fixture-main-r1", { exact: true }),
    ).toHaveLength(2);
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

    fireEvent.click(screen.getByRole("button", { name: "Open diff review" }));

    expect(
      screen.getByRole("region", { name: "Review diff and affected paths" }),
    ).toHaveTextContent("3 paths changed · 2 text files · 1 binary file");
    expect(
      screen.getByRole("region", {
        name: "Review diff and affected paths",
      }),
    ).toHaveTextContent("+14 −3 lines");
    expect(screen.getByText("README.md", { exact: true })).toBeVisible();
    expect(screen.getByText("src/hello.ts", { exact: true })).toBeVisible();
    expect(screen.getByText("assets/logo.png", { exact: true })).toBeVisible();
    expect(screen.getByText(/Binary file · content omitted/)).toBeVisible();
    expect(
      screen.getByText(
        "Binary content is not rendered as text; review remains safe for binary and generated files.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Diff review open" }),
    ).toBeDisabled();
  });

  it("blocks approval when the integration head advances past the checkpoint", () => {
    render(<AgentReviewCheckpointFixture />);

    fireEvent.click(screen.getByRole("button", { name: "Mark review-ready" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Advance integration head" }),
    );

    expect(
      screen.getByText("Integration head changed to fixture-main-r2.", {
        exact: true,
      }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Approve checkpoint" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Stale checkpoint · approval blocked",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The integration worktree advanced from fixture-main-r1 to fixture-main-r2.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No merge action started.",
    );
    expect(
      screen.getByRole("button", { name: "Approval blocked" }),
    ).toBeDisabled();
  });
});

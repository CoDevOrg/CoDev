import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SharedSessionQueueFixture } from "./shared-session-queue-fixture";

describe("SharedSessionQueueFixture", () => {
  it("opens an idle shared session with an empty durable queue", () => {
    render(<SharedSessionQueueFixture />);

    fireEvent.click(
      screen.getByRole("button", { name: "Open shared session" }),
    );

    expect(screen.getByLabelText("Open shared session")).toHaveTextContent(
      "Codex-compatible",
    );
    expect(screen.getByLabelText("Session metadata")).toHaveTextContent(
      "Idle · awaiting instruction",
    );
    expect(screen.getByLabelText("Ordered turn queue")).toHaveTextContent(
      "0 queued",
    );
    expect(
      screen.getByText("Queue is empty — no instructions are waiting."),
    ).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Shared session is open and idle with an empty ordered queue.",
    );
  });
});

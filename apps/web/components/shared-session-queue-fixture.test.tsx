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

  it("renders the provider metadata and ordered attributed transcript", () => {
    render(<SharedSessionQueueFixture />);

    fireEvent.click(
      screen.getByRole("button", { name: "Open shared session" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Run fixture transcript" }),
    );

    expect(screen.getByLabelText("Session metadata")).toHaveTextContent(
      "gpt-5 · standard",
    );
    expect(screen.getByLabelText("Session metadata")).toHaveTextContent(
      "Completed · 2 turns",
    );
    expect(screen.getByLabelText("Ordered transcript")).toHaveTextContent(
      "2 completed turns",
    );
    expect(screen.getByLabelText("Ordered transcript")).toHaveTextContent(
      "Alex MorganInspect the repository layout.Tool activity · read_file · README.mdOutputRepository structure is ready for the shared session.",
    );
    expect(screen.getByLabelText("Ordered transcript")).toHaveTextContent(
      "Jordan LeeSummarize the collaboration plan.Tool activity · list_files · src/OutputThe session keeps one ordered transcript for every collaborator.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Shared session transcript is complete and ordered by turn.",
    );
  });
});

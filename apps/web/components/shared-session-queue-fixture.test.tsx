import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { SharedSessionQueueFixture } from "./shared-session-queue-fixture";

describe("SharedSessionQueueFixture", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

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

  it("lets Jordan queue one attributed instruction while Alex observes live", () => {
    render(<SharedSessionQueueFixture />);

    fireEvent.click(
      screen.getByRole("button", { name: "Open shared session" }),
    );

    expect(
      screen.getByRole("button", { name: "Queue instruction as Jordan" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Queue instruction · unavailable" }),
    ).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Instruction to queue"), {
      target: { value: "Inspect the shared session contract." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Queue instruction as Jordan" }),
    );

    expect(screen.getByLabelText("Ordered turn queue")).toHaveTextContent(
      "1 queued",
    );
    expect(screen.getByLabelText("Queued instruction")).toHaveTextContent(
      "Jordan Lee · CollaboratorInspect the shared session contract.",
    );
    expect(
      screen.getByLabelText("Alex Morgan live observer"),
    ).toHaveTextContent("Jordan's instruction is visible to Alex Morgan.");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Jordan's instruction is queued and attributed for every session member.",
    );
    expect(
      screen.getByRole("button", { name: "Instruction queued" }),
    ).toBeDisabled();
  });

  it("lets Jordan interrupt a running turn while preserving its last action", () => {
    render(<SharedSessionQueueFixture />);

    fireEvent.click(
      screen.getByRole("button", { name: "Open shared session" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start controlled fixture turn" }),
    );

    expect(screen.getByLabelText("Session metadata")).toHaveTextContent(
      "Running · turn 3",
    );
    expect(
      screen.getByRole("button", { name: "Interrupt running turn as Jordan" }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Interrupt turn · unavailable" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Interrupt running turn as Jordan" }),
    );

    expect(screen.getByLabelText("Session metadata")).toHaveTextContent(
      "Interrupted · turn 3",
    );
    expect(screen.getByLabelText("Controlled fixture turn")).toHaveTextContent(
      "Cancellation recorded by Jordan Lee",
    );
    expect(screen.getByLabelText("Last completed action")).toHaveTextContent(
      "read_file · README.mdRepository structure is ready for the shared session.",
    );
    expect(
      screen.getByLabelText("Alex Morgan live observer"),
    ).toHaveTextContent(
      "Alex sees Jordan's cancellation and the preserved last completed action.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Turn 3 was interrupted by Jordan; the last completed action remains visible to every member.",
    );
  });

  it("restores the transcript, queue, and stream cursor after refresh", async () => {
    const firstRender = render(<SharedSessionQueueFixture />);

    fireEvent.click(
      screen.getByRole("button", { name: "Open shared session" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Run fixture transcript" }),
    );
    fireEvent.change(screen.getByLabelText("Instruction to queue"), {
      target: { value: "Inspect the shared session contract." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Queue instruction as Jordan" }),
    );

    await waitFor(() => {
      expect(
        window.localStorage.getItem("codev:verification:f3-5:shared-session"),
      ).toContain('"streamCursor":3');
    });

    firstRender.unmount();
    render(<SharedSessionQueueFixture />);

    await waitFor(() => {
      expect(screen.getByLabelText("Open shared session")).toBeVisible();
    });
    expect(screen.getByLabelText("Session metadata")).toHaveTextContent(
      "Stream cursor3",
    );
    expect(screen.getByLabelText("Ordered turn queue")).toHaveTextContent(
      "1 queued",
    );
    expect(screen.getAllByLabelText("Queued instruction")).toHaveLength(1);
    expect(screen.getByLabelText("Ordered transcript")).toHaveTextContent(
      "2 completed turns",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Session restored after browser refresh · stream cursor 3 · queued instruction preserved once.",
    );
    expect(
      screen.getByRole("button", { name: "Instruction queued" }),
    ).toBeDisabled();
  });
});

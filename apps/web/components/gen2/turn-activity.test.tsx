import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Gen2TurnItem } from "@codev/contracts";

import { Gen2TurnActivity } from "./turn-activity";

const noop = () => undefined;

describe("Gen2TurnActivity", () => {
  it("renders a command with its exit code and reveals output on demand", () => {
    const items: Gen2TurnItem[] = [
      {
        id: "c1",
        kind: "command",
        status: "completed",
        command: "pnpm test",
        output: "3 passed",
        exitCode: 0,
      },
    ];
    render(<Gen2TurnActivity items={items} onOpenFile={noop} />);
    expect(screen.getByText("pnpm test")).toBeInTheDocument();
    expect(screen.getByText("exit 0")).toBeInTheDocument();
    // Output is behind a disclosure so a long turn stays skimmable.
    expect(screen.queryByText("3 passed")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("3 passed")).toBeInTheDocument();
  });

  it("marks a failing command", () => {
    render(
      <Gen2TurnActivity
        items={[
          {
            id: "c1",
            kind: "command",
            status: "failed",
            command: "pnpm test",
            output: "",
            exitCode: 1,
          },
        ]}
        onOpenFile={noop}
      />,
    );
    expect(screen.getByText("exit 1")).toHaveAttribute("data-failed", "true");
  });

  it("opens the file a change card names", () => {
    const onOpenFile = vi.fn();
    render(
      <Gen2TurnActivity
        items={[
          {
            id: "f1",
            kind: "fileChange",
            status: "completed",
            changes: [{ path: "src/a.ts", change: "modify" }],
          },
        ]}
        onOpenFile={onOpenFile}
      />,
    );
    expect(screen.getByText("Edited 1 file")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /src\/a\.ts/ }));
    expect(onOpenFile).toHaveBeenCalledWith("src/a.ts");
  });

  it("shows the plan and which steps are done", () => {
    render(
      <Gen2TurnActivity
        items={[
          {
            id: "t1",
            kind: "todoList",
            status: "running",
            todos: [
              { text: "Read the repo", completed: true },
              { text: "Write the fix", completed: false },
            ],
          },
        ]}
        onOpenFile={noop}
      />,
    );
    expect(screen.getByText("Read the repo").closest("li")).toHaveAttribute(
      "data-done",
      "true",
    );
    expect(screen.getByText("Write the fix").closest("li")).toHaveAttribute(
      "data-done",
      "false",
    );
  });

  it("leaves the reply itself to the thread", () => {
    const { container } = render(
      <Gen2TurnActivity
        items={[
          { id: "m1", kind: "message", status: "completed", text: "Done." },
        ]}
        onOpenFile={noop}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("renders nothing when a turn has produced no activity yet", () => {
    const { container } = render(
      <Gen2TurnActivity items={[]} onOpenFile={noop} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

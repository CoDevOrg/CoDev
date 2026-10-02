import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Gen2TurnItem } from "@codev/contracts";

import { Gen2TurnActivity } from "./turn-activity";

const noop = () => undefined;

describe("Gen2TurnActivity", () => {
  it("collapses steps behind a Worked summary and reveals command detail on demand", () => {
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

    // Cursor-style: one muted summary, steps hidden until expanded.
    expect(screen.getByRole("button", { name: /Worked/ })).toBeInTheDocument();
    expect(screen.queryByText("Ran pnpm")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Worked/ }));
    expect(screen.getByText("Ran pnpm")).toBeInTheDocument();
    expect(screen.getByText("Command completed")).toBeInTheDocument();
    expect(screen.queryByText("3 passed")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Ran pnpm/ }));
    expect(screen.getByText("3 passed")).toBeInTheDocument();
    expect(screen.getByText("pnpm test")).toBeInTheDocument();
  });

  it("humanizes bash wrappers instead of showing the raw blob", () => {
    render(
      <Gen2TurnActivity
        items={[
          {
            id: "c1",
            kind: "command",
            status: "completed",
            command: `/bin/bash -lc "sed -n '1,240p' .codev/uploads/CODEV_FEATURES.md"`,
            output: "# Features",
            exitCode: 0,
          },
        ]}
        onOpenFile={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Worked/ }));
    expect(screen.getByText("Read CODEV_FEATURES.md")).toBeInTheDocument();
    expect(screen.queryByText(/\/bin\/bash/)).not.toBeInTheDocument();
  });

  it("marks a failing command in the detail line", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /Worked/ }));
    expect(screen.getByText("Failed · exit 1")).toBeInTheDocument();
  });

  it("opens the file a change step names", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /Worked/ }));
    expect(screen.getByText("Edited 1 file")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /src\/a\.ts/ }));
    expect(onOpenFile).toHaveBeenCalledWith("src/a.ts");
  });

  it("keeps file paths as buttons and uses a real failed status label", () => {
    render(
      <Gen2TurnActivity
        items={[
          {
            id: "c1",
            kind: "command",
            status: "failed",
            command: "pnpm test",
            output: "boom",
            exitCode: 1,
          },
          {
            id: "f1",
            kind: "fileChange",
            status: "completed",
            changes: [{ path: "src/a.ts", change: "add" }],
          },
        ]}
        onOpenFile={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Worked/ }));
    expect(screen.getByRole("button", { name: /src\/a\.ts/ })).toHaveAttribute(
      "data-change",
      "add",
    );
    expect(screen.getByRole("button", { name: /Ran pnpm/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
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
    // Running turns stay open so live progress is visible.
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

import { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// CodeMirror and xterm need real layout that jsdom does not provide, so the
// shell is tested against stand-ins. Their own logic is covered by the pure
// modules they build on.
vi.mock("./code-editor", () => ({
  Gen2CodeEditor: ({ path }: { path: string }) => (
    <div data-testid="gen2-editor">{path}</div>
  ),
}));
vi.mock("./terminal-pane", () => ({
  Gen2TerminalPane: ({ canStart }: { canStart: boolean }) => (
    <div data-testid="gen2-terminal" data-can-start={canStart} />
  ),
}));
vi.mock("./git-panel", () => ({
  Gen2GitPanel: () => <div data-testid="gen2-git" />,
}));

const { Gen2Workbench } = await import("./workbench");
type Handle = import("./workbench").Gen2WorkbenchHandle;

const workspaceId = "11111111-1111-4111-8111-111111111111";

function renderWorkbench(props: Partial<{ agentRunning: boolean }> = {}) {
  const handleRef =
    createRef<Handle | null>() as React.RefObject<Handle | null>;
  const onRefresh = vi.fn();
  render(
    <Gen2Workbench
      workspaceId={workspaceId}
      ready
      agentRunning={props.agentRunning ?? false}
      refreshToken={0}
      onRefresh={onRefresh}
      handleRef={handleRef}
    />,
  );
  return { handleRef, onRefresh };
}

describe("Gen2Workbench", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(
            JSON.stringify({
              file: { path: "src/a.ts", contents: "x", revision: "r1" },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ files: [{ path: "src/a.ts", status: "M" }] }),
          { status: 200 },
        );
      }),
    );
  });

  it("lists the machine's files and switches tabs", async () => {
    renderWorkbench();
    expect(await screen.findByText("a.ts")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("collapses to a rail and reopens on the tab that was clicked", async () => {
    renderWorkbench();
    fireEvent.click(screen.getByRole("button", { name: "Collapse workbench" }));
    expect(screen.queryByRole("tablist")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Git" }));
    expect(screen.getByRole("tab", { name: "Git" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("resizes from the keyboard and reports the width assistively", () => {
    renderWorkbench();
    const separator = screen.getByRole("separator", {
      name: "Resize workbench",
    });
    const before = Number(separator.getAttribute("aria-valuenow"));
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(Number(separator.getAttribute("aria-valuenow"))).toBe(before + 32);
  });

  it("opens the file the chat asked for and reveals the Files tab", async () => {
    const { handleRef } = renderWorkbench();
    await screen.findByText("a.ts");
    fireEvent.click(screen.getByRole("tab", { name: "Git" }));

    handleRef.current?.openFile("src/a.ts");

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(await screen.findByTestId("gen2-editor")).toHaveTextContent(
      "src/a.ts",
    );
  });

  it("stops a new terminal from starting while Codex holds the machine", () => {
    renderWorkbench({ agentRunning: true });
    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    expect(screen.getByTestId("gen2-terminal")).toHaveAttribute(
      "data-can-start",
      "false",
    );
  });

  it("tells a member to start the instance before there is anything to show", () => {
    const handleRef =
      createRef<Handle | null>() as React.RefObject<Handle | null>;
    render(
      <Gen2Workbench
        workspaceId={workspaceId}
        ready={false}
        agentRunning={false}
        refreshToken={0}
        onRefresh={vi.fn()}
        handleRef={handleRef}
      />,
    );
    expect(
      screen.getByText(/Start the instance to see this workspace/),
    ).toBeInTheDocument();
  });
});

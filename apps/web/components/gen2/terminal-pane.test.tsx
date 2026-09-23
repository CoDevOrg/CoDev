import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    rows = 24;
    cols = 80;
    onData = vi.fn();
    loadAddon() {}
    open() {}
    dispose() {}
    write() {}
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

import { Gen2TerminalPane } from "./terminal-pane";

const workspaceId = "11111111-1111-4111-8111-111111111111";

describe("Gen2TerminalPane", () => {
  beforeEach(() => {
    class ResizeObserverStub {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  it("offers an explicit resume when idle hibernation disconnects the terminal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as {
          action?: string;
        };
        return request.action === "start"
          ? new Response(JSON.stringify({ sessionId: "terminal-1" }), {
              status: 200,
            })
          : new Response(JSON.stringify({ error: "sandbox stopped" }), {
              status: 503,
            });
      }),
    );
    const onResumeWorkspace = vi.fn(async () => true);

    render(
      <Gen2TerminalPane
        workspaceId={workspaceId}
        visible
        canStart
        onExit={vi.fn()}
        onResumeWorkspace={onResumeWorkspace}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start terminal" }));
    const resume = await screen.findByRole("button", {
      name: "Resume workspace",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The terminal disconnected when the workspace stopped.",
    );

    fireEvent.click(resume);
    await waitFor(() => expect(onResumeWorkspace).toHaveBeenCalledOnce());
  });
});

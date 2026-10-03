import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const terminalMocks = vi.hoisted(() => ({
  instances: [] as Array<{ onDataHandler?: (data: string) => void }>,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    rows = 24;
    cols = 80;
    onDataHandler?: (data: string) => void;

    constructor() {
      terminalMocks.instances.push(this);
    }

    onData(handler: (data: string) => void) {
      this.onDataHandler = handler;
    }

    attachCustomKeyEventHandler() {}

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
    terminalMocks.instances.length = 0;
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
      name: "Reconnect workspace",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The workspace was inactive for more than 15 minutes.",
    );

    fireEvent.click(resume);
    await waitFor(() => expect(onResumeWorkspace).toHaveBeenCalledOnce());
  });

  it("batches input typed before the request leaves, without changing order", async () => {
    const inputCalls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as {
          action?: string;
          data?: string;
        };
        if (request.action === "start") {
          return new Response(JSON.stringify({ sessionId: "terminal-1" }), {
            status: 201,
          });
        }
        if (request.action === "input") {
          inputCalls.push(request.data ?? "");
          return new Response(null, { status: 204 });
        }
        if (request.action === "poll") {
          return new Promise<Response>(() => {});
        }
        return new Response(null, { status: 204 });
      }),
    );

    const { unmount } = render(
      <Gen2TerminalPane
        workspaceId={workspaceId}
        visible
        canStart
        onExit={vi.fn()}
        onResumeWorkspace={vi.fn(async () => true)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start terminal" }));
    await waitFor(() =>
      expect(terminalMocks.instances[0]?.onDataHandler).toBeDefined(),
    );
    const sendInput = terminalMocks.instances[0]!.onDataHandler!;
    sendInput("p");
    sendInput("w");
    sendInput("d");

    await waitFor(() => expect(inputCalls).toEqual(["pwd"]));
    unmount();
  });

  it("auto-starts terminal when autoStart is true without requiring button click", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const request = JSON.parse(String(init?.body ?? "{}")) as {
            action?: string;
          };
          if (request.action === "start") {
            return new Response(
              JSON.stringify({ sessionId: "terminal-autostart" }),
              { status: 201 },
            );
          }
          return new Response(null, { status: 204 });
        },
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Gen2TerminalPane
        workspaceId={workspaceId}
        visible
        canStart
        autoStart
        onExit={vi.fn()}
      />,
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Opening the terminal",
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/gen2/workspaces/${workspaceId}/terminal`,
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"action":"start"'),
        }),
      );
    });
  });

  it("opens the shell while the workspace check is still running", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ sessionId: "terminal-waking" }), {
        status: 201,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Gen2TerminalPane
        workspaceId={workspaceId}
        visible
        canStart
        autoStart
        workspaceConnection="waking"
        onExit={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/gen2/workspaces/${workspaceId}/terminal`,
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"action":"start"'),
        }),
      );
    });
    expect(
      screen.queryByText("Waiting for the workspace"),
    ).not.toBeInTheDocument();
  });
});

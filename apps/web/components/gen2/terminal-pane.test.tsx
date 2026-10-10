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

    buffer = {
      active: {
        length: 3,
        getLine: (y: number) =>
          [
            { isWrapped: false, translateToString: () => "$ npm test" },
            { isWrapped: false, translateToString: () => "1 passed" },
            { isWrapped: false, translateToString: () => "" },
          ][y],
      },
    };

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
    // These cases exercise HTTP fallback, without a real network connection.
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          throw new Error("WebSocket unavailable in HTTP fallback test");
        }
      },
    );
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

  it("sends input in order while the output poll remains open", async () => {
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

    await waitFor(() => expect(inputCalls.join("")).toBe("pwd"));
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

  it("types a queued command once into its own new session, and exposes the screen", async () => {
    const inputCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as {
          action?: string;
          data?: string;
        };
        if (request.action === "start") {
          return new Response(JSON.stringify({ sessionId: "terminal-run" }), {
            status: 201,
          });
        }
        if (request.action === "input") inputCalls.push(request.data ?? "");
        if (request.action === "poll") return new Promise<Response>(() => {});
        return new Response(null, { status: 204 });
      }),
    );
    const readers: Array<(() => string) | null> = [];
    const queuedInput = { id: "run-1", text: "npm test\r" };
    const props = {
      workspaceId,
      visible: true,
      canStart: true,
      autoStart: true,
      onExit: vi.fn(),
      onTailReader: (read: (() => string) | null) => readers.push(read),
    };

    const { rerender, unmount } = render(
      <Gen2TerminalPane {...props} queuedInput={queuedInput} />,
    );
    await waitFor(() => expect(inputCalls).toEqual(["npm test\r"]));
    rerender(<Gen2TerminalPane {...props} queuedInput={{ ...queuedInput }} />);
    await waitFor(() => expect(readers.at(-1)).toBeTypeOf("function"));
    expect(readers.at(-1)?.()).toBe("$ npm test\n1 passed");
    expect(inputCalls).toEqual(["npm test\r"]);
    unmount();
    expect(readers.at(-1)).toBeNull();
  });
});

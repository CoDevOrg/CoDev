import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type KeyHandler = (event: Partial<KeyboardEvent>) => boolean;

const terminalMocks = vi.hoisted(() => ({
  instances: [] as Array<{
    onDataHandler?: (data: string) => void;
    keyHandler?: (event: Partial<KeyboardEvent>) => boolean;
    selection: string;
    written: string[];
  }>,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    rows = 24;
    cols = 80;
    selection = "";
    options: Record<string, unknown> = {};
    unicode = { activeVersion: "" };
    written: string[] = [];
    onDataHandler?: (data: string) => void;
    keyHandler?: KeyHandler;

    constructor() {
      terminalMocks.instances.push(this);
    }

    onData(handler: (data: string) => void) {
      this.onDataHandler = handler;
    }

    onSelectionChange() {}
    attachCustomKeyEventHandler(handler: KeyHandler) {
      this.keyHandler = handler;
    }
    hasSelection() {
      return this.selection.length > 0;
    }
    getSelection() {
      return this.selection;
    }
    loadAddon() {}
    open() {}
    reset() {}
    focus() {}
    clear() {}
    selectAll() {}
    paste() {}
    dispose() {}
    write(data: string) {
      this.written.push(data);
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}));

vi.mock("@xterm/addon-unicode11", () => ({
  Unicode11Addon: class {},
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    onDidChangeResults() {}
    findNext() {
      return true;
    }
    findPrevious() {
      return true;
    }
    clearDecorations() {}
  },
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss() {}
    dispose() {}
  },
}));

import { Gen2TerminalPane } from "./terminal-pane";

const workspaceId = "11111111-1111-4111-8111-111111111111";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: URL) {
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  emit(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

/** A stream route that cannot be reached: the pane must fall back to polling. */
class UnreachableSocket extends FakeSocket {
  constructor(url: URL) {
    super(url);
    queueMicrotask(() => this.close());
  }
}

describe("Gen2TerminalPane", () => {
  beforeEach(() => {
    terminalMocks.instances.length = 0;
    class ResizeObserverStub {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    FakeSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", UnreachableSocket);
  });

  it("streams over a WebSocket: output is pushed and keystrokes skip HTTP", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const actions: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as {
          action?: string;
        };
        actions.push(request.action ?? "");
        return new Response(JSON.stringify({ sessionId: "term-1-1" }), {
          status: 201,
        });
      }),
    );
    const onExit = vi.fn();

    const { unmount } = render(
      <Gen2TerminalPane
        workspaceId={workspaceId}
        visible
        canStart
        onExit={onExit}
      />,
    );

    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0]!;
    expect(socket.url.pathname).toBe(
      `/api/gen2/workspaces/${workspaceId}/terminal/stream`,
    );
    expect(socket.url.searchParams.get("sessionId")).toBe("term-1-1");
    expect(socket.url.searchParams.get("after")).toBe("0");
    socket.open();

    socket.emit({ type: "data", data: "$ ", next: 2 });
    await waitFor(() =>
      expect(terminalMocks.instances[0]?.written).toEqual(["$ "]),
    );

    terminalMocks.instances[0]!.onDataHandler!("ls\r");
    expect(socket.sent).toContain(
      JSON.stringify({ type: "input", data: "ls\r" }),
    );
    expect(actions).toEqual(["start"]);

    // A dropped socket resumes from the last position seen.
    socket.close();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    expect(FakeSocket.instances[1]!.url.searchParams.get("after")).toBe("2");

    FakeSocket.instances[1]!.open();
    FakeSocket.instances[1]!.emit({ type: "exit", exitCode: 0, next: 5 });
    await waitFor(() => expect(onExit).toHaveBeenCalledOnce());
    unmount();
  });

  it("opens the shell on its own, without a Start button", async () => {
    const actions: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as {
          action?: string;
          after?: number;
        };
        actions.push(request.action ?? "");
        if (request.action === "start") {
          return new Response(JSON.stringify({ sessionId: "term-1-1" }), {
            status: 201,
          });
        }
        const first = request.after === 0;
        return new Response(
          JSON.stringify({
            chunks: first
              ? [
                  { sequence: 0, data: "hello " },
                  { sequence: 1, data: "world" },
                ]
              : [],
            nextSequence: 2,
            exited: false,
          }),
        );
      }),
    );

    const { unmount } = render(
      <Gen2TerminalPane
        workspaceId={workspaceId}
        visible
        canStart
        onExit={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /^start/i })).toBeNull();
    await waitFor(() => expect(actions).toContain("poll"));
    // Chunks from one poll reach the screen as a single write.
    await waitFor(() =>
      expect(terminalMocks.instances[0]?.written[0]).toBe("hello world"),
    );
    unmount();
  });

  it("waits for Codex to finish its turn before opening", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Gen2TerminalPane
        workspaceId={workspaceId}
        visible
        canStart={false}
        onExit={vi.fn()}
      />,
    );

    expect(await screen.findByText(/Codex is working/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers an explicit resume when idle hibernation disconnects the terminal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "sandbox stopped" }, { status: 503 }),
      ),
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

    const resume = await screen.findByRole("button", {
      name: "Resume workspace",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The terminal disconnected when the workspace stopped.",
    );

    fireEvent.click(resume);
    await waitFor(() => expect(onResumeWorkspace).toHaveBeenCalledOnce());
  });

  it("keeps typed characters in order and batches what piles up in flight", async () => {
    let releaseFirstInput!: () => void;
    const firstInput = new Promise<void>((resolve) => {
      releaseFirstInput = resolve;
    });
    const inputCalls: string[] = [];
    let polling = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as {
          action?: string;
          data?: string;
        };
        if (request.action === "start") {
          return new Response(JSON.stringify({ sessionId: "term-1-1" }), {
            status: 201,
          });
        }
        if (request.action === "input") {
          inputCalls.push(request.data ?? "");
          if (inputCalls.length === 1) await firstInput;
          return new Response(null, { status: 204 });
        }
        if (request.action === "poll") {
          polling = true;
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

    // Input is dropped until the session id has come back.
    await waitFor(() => expect(polling).toBe(true));
    const sendInput = terminalMocks.instances[0]!.onDataHandler!;
    sendInput("p");
    await waitFor(() => expect(inputCalls).toEqual(["p"]));
    sendInput("w");
    sendInput("d");

    try {
      expect(inputCalls).toEqual(["p"]);
    } finally {
      releaseFirstInput();
    }

    await waitFor(() => expect(inputCalls).toEqual(["p", "wd"]));
    unmount();
  });

  it("copies the selection with the platform shortcut and leaves Ctrl+C as an interrupt", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ sessionId: "term-1-1" }, { status: 201 }),
      ),
    );

    const { unmount } = render(
      <Gen2TerminalPane
        workspaceId={workspaceId}
        visible
        canStart
        onExit={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(terminalMocks.instances[0]?.keyHandler).toBeDefined(),
    );
    const term = terminalMocks.instances[0]!;
    const press = (init: Partial<KeyboardEvent>) =>
      term.keyHandler!({
        type: "keydown",
        altKey: false,
        preventDefault: () => {},
        ...init,
      });

    // No selection: Ctrl+C reaches the shell.
    expect(press({ key: "c", ctrlKey: true, shiftKey: false })).toBe(true);

    term.selection = "echo hi";
    expect(press({ key: "C", ctrlKey: true, shiftKey: true })).toBe(false);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("echo hi"));

    // Paste is left to the browser so xterm receives a real paste event.
    expect(press({ key: "v", ctrlKey: true, shiftKey: true })).toBe(false);
    unmount();
  });
});

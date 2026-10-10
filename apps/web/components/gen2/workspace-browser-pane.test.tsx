import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceBrowserPane } from "./workspace-browser-pane";
import { WORKSPACE_ACTIVITY_EVENT } from "./use-workspace-connection";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const sessionUrl = (port: number, token = "t1") =>
  `https://p${port}-0123456789abcdef0123-g2.codev-preview.dev/__codev/preview/session?token=${token}&next=%2F`;

type PortsReply = {
  available: boolean;
  reason: string | null;
  ports: Array<{ port: number; address: string }>;
};

function serve(ports: () => PortsReply, sessions: string[] = []) {
  let minted = 0;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/preview/ports")) return Response.json(ports());
    if (url.endsWith("/preview") && init?.method === "POST") {
      const { port } = JSON.parse(String(init.body)) as { port: number };
      minted += 1;
      return Response.json({
        url: sessions[minted - 1] ?? sessionUrl(port, `t${minted}`),
        expiresAt: "2026-10-09T12:01:00.000Z",
      });
    }
    return Response.json({ error: "unexpected" }, { status: 404 });
  });
}

const mints = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).endsWith("/preview")).length;

const listening = (...ports: number[]): PortsReply => ({
  available: true,
  reason: null,
  ports: ports.map((port) => ({ port, address: "loopback" })),
});

function renderPane(
  overrides: Partial<Parameters<typeof WorkspaceBrowserPane>[0]> = {},
) {
  const props = {
    workspaceId,
    visible: true,
    canEdit: true,
    connected: true,
    request: null,
    onExpandChange: vi.fn(),
    onStateChange: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<WorkspaceBrowserPane {...props} />) };
}

/** Runs timers, then lets the chained effects, fetches and timers finish. */
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  for (let round = 0; round < 6; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

describe("WorkspaceBrowserPane", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
    sessionStorage.clear();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("tells viewers and disconnected members why, without asking the guest", async () => {
    const { rerender, props } = renderPane({ canEdit: false });
    await settle();
    expect(
      screen.getByText("Only editors can open previews"),
    ).toBeInTheDocument();
    rerender(<WorkspaceBrowserPane {...props} connected={false} />);
    expect(
      screen.getByText("Previews load when the workspace is connected."),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["not_configured", "Browser previews aren’t set up"],
    ["image_update", "Update this workspace to use the browser"],
  ])("explains an unavailable preview (%s)", async (reason, copy) => {
    serve(() => ({ available: false, reason, ports: [] }));
    renderPane();
    await settle();
    expect(screen.getByText(copy)).toBeInTheDocument();
  });

  it("opens nothing, typed or restored, while the guest cannot serve previews", async () => {
    sessionStorage.setItem(
      `codev-gen2-preview:${workspaceId}`,
      JSON.stringify({ port: 3000, path: "/" }),
    );
    serve(() => ({ available: false, reason: "image_update", ports: [] }));
    renderPane({ request: { id: "r1", port: 3000, path: "/" } });
    await settle();
    expect(
      screen.getByText("Update this workspace to use the browser"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Preview address")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Reload preview" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Open in new tab" }),
    ).toBeDisabled();
    await settle(60_000);
    expect(mints()).toBe(0);
  });

  it("shows fixed copy when an edge error page replaces the JSON", async () => {
    const page = (status: number) =>
      new Response("<!DOCTYPE html><title>Error</title>", {
        status,
        headers: { "content-type": "text/html" },
      });
    vi.mocked(fetch).mockResolvedValue(page(524));
    renderPane();
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn’t check for dev servers.",
    );
    serve(() => listening(3000));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle();
    vi.mocked(fetch).mockResolvedValue(page(502));
    fireEvent.click(screen.getByRole("button", { name: ":3000" }));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn’t open the preview.",
    );
  });

  it("says when no dev server is running, and when the guest is busy", async () => {
    let reply = listening();
    serve(() => reply);
    renderPane();
    await settle();
    expect(screen.getByText("No dev server running")).toBeInTheDocument();
    reply = { available: false, reason: "busy", ports: [] };
    // Opening the dev server menu checks again.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Dev servers" }), {
      button: 0,
      ctrlKey: false,
    });
    await settle();
    expect(screen.getAllByText("Workspace is busy — try again")).toHaveLength(
      2,
    );
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Workspace is busy — try again",
    );
  });

  it("opens a requested port in a sandboxed, referrer-free frame and reports it", async () => {
    serve(() => listening(3000, 5173));
    const { props } = renderPane({
      request: { id: "r1", port: 5173, path: "/docs" },
    });
    await settle();
    const frame = screen.getByTitle("Workspace preview");
    expect(frame).toHaveAttribute("src", sessionUrl(5173, "t1"));
    expect(frame).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads",
    );
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(frame).toHaveAttribute("allow", "");
    const [, init] = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith("/preview"))!;
    expect(JSON.parse(String(init?.body))).toEqual({
      port: 5173,
      path: "/docs",
    });
    expect(screen.getByText("Loading :5173…")).toBeInTheDocument();
    fireEvent.load(frame);
    expect(screen.queryByText("Loading :5173…")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Preview address")).toHaveValue(
      "localhost:5173/docs",
    );
    expect(props.onStateChange).toHaveBeenLastCalledWith({
      port: 5173,
      path: "/docs",
      listeningPorts: [3000, 5173],
    });
    expect(
      JSON.parse(sessionStorage.getItem(`codev-gen2-preview:${workspaceId}`)!),
    ).toEqual({ port: 5173, path: "/docs" });
  });

  it("waits for a requested port to start listening, then gives up after a minute", async () => {
    let reply = listening();
    serve(() => reply);
    renderPane({ request: { id: "r1", port: 3000, path: "/" } });
    await settle();
    expect(screen.getByText("Waiting for :3000…")).toBeInTheDocument();
    reply = listening(3000);
    await settle(2_000);
    expect(screen.getByTitle("Workspace preview")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Preview address"), {
      target: { value: "4000" },
    });
    fireEvent.submit(screen.getByLabelText("Preview address"));
    await settle();
    expect(screen.getByText("Waiting for :4000…")).toBeInTheDocument();
    await settle(60_000);
    expect(
      screen.getByText("Nothing is listening on :4000 yet"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open anyway" }));
    await settle();
    expect(screen.getByTitle("Workspace preview")).toHaveAttribute(
      "src",
      sessionUrl(4000, "t2"),
    );
  });

  it("refuses addresses on other hosts", async () => {
    serve(() => listening(3000));
    renderPane();
    await settle();
    const field = screen.getByLabelText("Preview address");
    fireEvent.change(field, { target: { value: "evil.example:3000" } });
    fireEvent.submit(field);
    await settle();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => String(url).endsWith("/preview")),
    ).toBe(false);
  });

  it("cancels a wait and offers the listening ports instead", async () => {
    serve(() => listening(8080));
    renderPane({ request: { id: "r1", port: 3000, path: "/" } });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByText("Choose a dev server to preview"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ":8080" }));
    await settle();
    expect(screen.getByTitle("Workspace preview")).toHaveAttribute(
      "src",
      sessionUrl(8080, "t1"),
    );
  });

  it("expands on request and opens a fresh session in a new tab", async () => {
    serve(() => listening(3000));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { props } = renderPane({
      request: { id: "r1", port: 3000, path: "/" },
    });
    await settle();
    const expand = screen.getByRole("button", { name: "Expand preview" });
    fireEvent.click(expand);
    expect(props.onExpandChange).toHaveBeenLastCalledWith(true);
    expect(expand).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Open in new tab" }));
    await settle();
    expect(open).toHaveBeenCalledWith(
      sessionUrl(3000, "t2"),
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("lists again after a reconnect instead of trusting the old ports", async () => {
    let reply = listening(3000);
    serve(() => reply);
    const { rerender, props } = renderPane({
      request: { id: "r1", port: 3000, path: "/" },
    });
    await settle();
    expect(mints()).toBe(1);
    rerender(<WorkspaceBrowserPane {...props} connected={false} />);
    await settle();
    // The restarted guest has not started the dev server again yet.
    reply = listening();
    rerender(<WorkspaceBrowserPane {...props} connected />);
    await settle();
    expect(screen.getByText("Waiting for :3000…")).toBeInTheDocument();
    expect(mints()).toBe(1);
    reply = listening(3000);
    await settle(2_000);
    expect(screen.getByTitle("Workspace preview")).toHaveAttribute(
      "src",
      sessionUrl(3000, "t2"),
    );
  });

  it("reports the last listing while hidden, and forgets it on disconnect", async () => {
    serve(() => listening(3000, 8080));
    const { rerender, props } = renderPane();
    await settle();
    const reported = (listeningPorts: number[] | null) =>
      expect(props.onStateChange).toHaveBeenLastCalledWith({
        port: null,
        path: "/",
        listeningPorts,
      });
    reported([3000, 8080]);
    rerender(<WorkspaceBrowserPane {...props} visible={false} />);
    await settle();
    reported([3000, 8080]);
    rerender(
      <WorkspaceBrowserPane {...props} visible={false} connected={false} />,
    );
    await settle();
    reported(null);
  });

  it("restores the last address of this tab session", async () => {
    sessionStorage.setItem(
      `codev-gen2-preview:${workspaceId}`,
      JSON.stringify({ port: 3000, path: "/admin" }),
    );
    serve(() => listening(3000));
    renderPane();
    await settle();
    expect(screen.getByLabelText("Preview address")).toHaveValue(
      "localhost:3000/admin",
    );
    expect(screen.getByTitle("Workspace preview")).toBeInTheDocument();
  });

  it("renews the session in a hidden script-less frame and reports focused use", async () => {
    serve(() => listening(3000));
    renderPane({ request: { id: "r1", port: 3000, path: "/" } });
    await settle();
    const frame = screen.getByTitle("Workspace preview");
    fireEvent.load(frame);
    await settle(4 * 60_000);
    const refresh = screen.getByTitle("Preview session for :3000");
    expect(refresh).toHaveAttribute("src", sessionUrl(3000, "t2"));
    expect(refresh).toHaveAttribute("sandbox", "allow-same-origin");
    fireEvent.load(refresh);
    expect(screen.queryByTitle("Preview session for :3000")).toBeNull();

    const activity = vi.fn();
    window.addEventListener(WORKSPACE_ACTIVITY_EVENT, activity);
    frame.tabIndex = 0;
    frame.focus();
    await settle(60_000);
    expect(activity).toHaveBeenCalled();

    // Another app has the member's attention; the frame only kept focus.
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    activity.mockClear();
    await settle(60_000);
    expect(activity).not.toHaveBeenCalled();
    hasFocus.mockRestore();

    // A focused but unattended preview stops counting after half an hour.
    await settle(30 * 60_000);
    expect(activity).toHaveBeenCalled();
    activity.mockClear();
    await settle(2 * 60_000);
    expect(activity).not.toHaveBeenCalled();
    window.removeEventListener(WORKSPACE_ACTIVITY_EVENT, activity);
  });
});

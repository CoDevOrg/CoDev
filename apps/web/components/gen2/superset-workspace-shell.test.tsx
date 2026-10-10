import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connected: true,
  cursorConnected: false,
  initialChatProvider: undefined as string | undefined,
  renameOk: true,
  listWorktrees: vi.fn(),
  createWorktree: vi.fn(),
  expandPreview: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("./superset-file-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./superset-file-client")>()),
  listSupersetWorktrees: mocks.listWorktrees,
  createSupersetWorktree: mocks.createWorktree,
}));

vi.mock("./superset-file-pane", () => ({
  SupersetFilePane: ({
    worktreeId,
    onDirtyChange,
    requestedPath,
  }: {
    worktreeId?: string;
    onDirtyChange?: (dirty: boolean) => void;
    requestedPath?: string | null;
  }) => (
    <div
      data-testid="files"
      data-worktree-id={worktreeId}
      data-requested-path={requestedPath ?? undefined}
    >
      <button
        type="button"
        data-testid="make-dirty"
        onClick={() => onDirtyChange?.(true)}
      >
        Set Dirty
      </button>
    </div>
  ),
}));

vi.mock("./terminal-pane", () => ({
  Gen2TerminalPane: ({ worktreeId }: { worktreeId?: string }) => (
    <div data-testid="terminal" data-worktree-id={worktreeId} />
  ),
}));

vi.mock("./review-diff-viewer", () => ({
  ReviewDiffViewer: ({ patch }: { patch: string }) => (
    <pre data-testid="review-diff">{patch}</pre>
  ),
}));

vi.mock("./use-workspace-inspector-size", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./use-workspace-inspector-size")>();
  return {
    useWorkspaceInspectorSize: (browserActive: boolean) => {
      const size = actual.useWorkspaceInspectorSize(browserActive);
      return {
        ...size,
        onExpandChange: (expanded: boolean) => {
          mocks.expandPreview(expanded, browserActive, size.maxSize);
          size.onExpandChange(expanded);
        },
      };
    },
  };
});

vi.mock("./workspace-browser-pane", async () => {
  const { useWorkspaceAgent } = await import("./workspace-controller");
  return {
    WorkspaceBrowserPane: function MockBrowserPane({
      visible,
      request,
      onExpandChange,
    }: {
      visible: boolean;
      request: { port: number } | null;
      onExpandChange: (expanded: boolean) => void;
    }) {
      const agent = useWorkspaceAgent();
      return (
        <div
          data-testid="browser-pane"
          data-visible={visible}
          data-port={request?.port}
          data-has-agent={agent ? "true" : "false"}
        >
          <button type="button" onClick={() => onExpandChange(true)}>
            Expand preview
          </button>
        </div>
      );
    },
  };
});

vi.mock("./chat-panel", async () => {
  const { useWorkspaceAgent } = await import("./workspace-controller");
  const { useState } = await import("react");
  return {
    Gen2ChatPanel: function MockChatPanel({
      worktreeId,
      activeProvider,
      onOpenFile,
      onOpenWorktree,
    }: {
      worktreeId?: string;
      activeProvider?: string;
      onOpenFile?: (path: string) => void;
      onOpenWorktree?: (worktreeId: string) => void;
    }) {
      const agent = useWorkspaceAgent();
      const [result, setResult] = useState("");
      return (
        <div
          data-testid="chat-panel"
          data-worktree-id={worktreeId}
          data-provider={activeProvider}
        >
          <output data-testid="action-result">{result}</output>
          <button type="button" onClick={() => onOpenWorktree?.("run-7")}>
            Open the other run
          </button>
          <button
            type="button"
            onClick={() =>
              void agent?.controller
                .run({ type: "switch_worktree", worktreeId: "feature-auth" })
                .then((outcome) => setResult(outcome.message))
            }
          >
            Agent switches worktree
          </button>
          <button type="button" onClick={() => onOpenFile?.("src/login.ts")}>
            Chat opens a file
          </button>
          <button
            type="button"
            onClick={() =>
              void agent?.controller.run({
                type: "run_in_terminal",
                command: "npm test",
              })
            }
          >
            Agent runs a command
          </button>
          <button
            type="button"
            onClick={() =>
              void agent?.controller.run({ type: "open_preview", port: 3000 })
            }
          >
            Agent opens a preview
          </button>
        </div>
      );
    },
  };
});

vi.mock("@/lib/gen2/startup-client", () => ({
  ensureGen2WorkspaceReady: vi.fn().mockResolvedValue({
    workspace: {
      id: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
      status: "ready",
      sandboxId: "sb-1",
    },
  }),
}));

import {
  GEN2_INSPECTOR_COLLAPSE_QUERY,
  GEN2_SIDEBAR_COLLAPSE_QUERY,
  SupersetWorkspaceShell,
} from "./superset-workspace-shell";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";

function stubMatchMedia(matchesFor: (query: string) => boolean) {
  window.matchMedia = ((query: string) => ({
    matches: matchesFor(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("SupersetWorkspaceShell", () => {
  beforeEach(() => {
    mocks.connected = true;
    mocks.cursorConnected = false;
    mocks.initialChatProvider = undefined;
    mocks.renameOk = true;
    stubMatchMedia(() => false);
    mocks.listWorktrees.mockResolvedValue([
      { worktreeId: "main", branch: "main" },
      { worktreeId: "feature-auth", branch: "feature/auth" },
    ]);
    mocks.createWorktree.mockResolvedValue({
      worktreeId: "fix-login",
      branch: "fix/login",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.endsWith("/activity"))
          return Promise.resolve(Response.json({ connected: mocks.connected }));
        if (urlStr.includes("/api/gen2/providers")) {
          return Promise.resolve(
            Response.json({
              codex: { connected: true, via: "api-key" },
              claude: { connected: false, via: null },
              cursor: { connected: mocks.cursorConnected, via: "subscription" },
            }),
          );
        }
        if (urlStr.includes("/chats/") && init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as { title?: string };
          if (!mocks.renameOk) {
            return Promise.resolve(
              Response.json(
                { error: "Couldn't rename that chat." },
                { status: 400 },
              ),
            );
          }
          return Promise.resolve(
            Response.json({
              chat: {
                id: "chat-1",
                title: body.title,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
          );
        }
        if (urlStr.includes("/chats") && init?.method === "POST") {
          const { provider } = JSON.parse(String(init.body ?? "{}")) as {
            provider?: string;
          };
          return Promise.resolve(
            Response.json({
              chat: {
                id: "chat-new",
                title: "New Chat",
                provider,
                messageCount: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
          );
        }
        if (urlStr.includes("/chats")) {
          return Promise.resolve(
            Response.json({
              chats: [
                {
                  id: "chat-1",
                  title: "Initial Workspace Session",
                  provider: mocks.initialChatProvider,
                  messageCount: 1,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ],
            }),
          );
        }
        return Promise.resolve(
          Response.json({ output: "## feature/auth\n M src/login.ts\n" }),
        );
      }),
    );
  });

  it("links home from the top bar and shows the CoDev mark", () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute(
      "href",
      "/gen2",
    );
    expect(screen.getByRole("img", { name: "CoDev" })).toHaveAttribute(
      "src",
      "/brand/codev-mark.svg",
    );
  });

  it("finds a worktree created by an agent when the switcher opens", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    await waitFor(() => expect(mocks.listWorktrees).toHaveBeenCalled());
    mocks.listWorktrees.mockResolvedValue([
      { worktreeId: "main", branch: "main" },
      { worktreeId: "feature-auth", branch: "feature/auth" },
      { worktreeId: "test-2", branch: "test-2" },
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "Active worktree: main" }),
    );
    expect(
      await screen.findByRole("button", { name: /test-2/ }),
    ).toBeInTheDocument();
  });

  it("switches every Superset panel to the selected host worktree", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    const featureBranch = await screen.findByRole("button", {
      name: /feature\/auth/,
    });
    fireEvent.click(featureBranch);
    expect(screen.getByTestId("files")).toHaveAttribute(
      "data-worktree-id",
      "feature-auth",
    );
    expect(screen.getByTestId("terminal")).toHaveAttribute(
      "data-worktree-id",
      "feature-auth",
    );

    // Radix tabs activate on mousedown, as a real click does before it clicks.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Changes" }));
    expect(await screen.findByText("src/login.ts")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    expect(screen.getByTestId("chat-panel")).toHaveAttribute(
      "data-worktree-id",
      "feature-auth",
    );

    expect(screen.getByLabelText("Expand terminal")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Expand terminal"));
    expect(screen.getByLabelText("Collapse terminal")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("Collapse terminal"), {
      key: " ",
    });
    expect(screen.getByLabelText("Expand terminal")).toBeInTheDocument();
    expect(screen.getByTestId("terminal")).toHaveAttribute(
      "data-worktree-id",
      "feature-auth",
    );
    expect(
      screen.queryByRole("button", { name: "Workspaces" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New workspace" }),
    ).not.toBeInTheDocument();
  });

  it("collapses the rails from the viewport and keeps worktree switching available", async () => {
    stubMatchMedia(
      (query) =>
        query === GEN2_SIDEBAR_COLLAPSE_QUERY ||
        query === GEN2_INSPECTOR_COLLAPSE_QUERY,
    );
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );

    expect(screen.getByLabelText("Expand sidebar")).toBeInTheDocument();
    expect(screen.getByLabelText("Expand inspector")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Files" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Active worktree: main" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /feature\/auth/ }),
    );
    expect(screen.getByTestId("chat-panel")).toHaveAttribute(
      "data-worktree-id",
      "feature-auth",
    );
  });

  it("lets editors create and select a Superset-owned worktree", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    await screen.findByRole("button", { name: "New worktree" });
    fireEvent.click(screen.getByRole("button", { name: "New worktree" }));
    // A new branch is the default choice; the folder name is optional.
    fireEvent.change(screen.getByLabelText("New branch name"), {
      target: { value: "fix/login" },
    });
    fireEvent.change(screen.getByLabelText(/Folder name/), {
      target: { value: "Fix Login" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create worktree" }));

    await waitFor(() =>
      expect(mocks.createWorktree).toHaveBeenCalledWith(workspaceId, {
        worktreeId: "fix-login",
        branch: "fix/login",
      }),
    );
    expect(screen.getByTestId("files")).toHaveAttribute(
      "data-worktree-id",
      "fix-login",
    );
  });

  it("restores the view a link names after a refresh, and keeps the URL on it", async () => {
    window.history.replaceState(null, "", "/gen2/ws?ref=home");
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
        initialView={{
          worktreeId: "feature-auth",
          chatId: null,
          tab: "changes",
          file: "src/auth.ts",
          board: false,
          terminal: false,
        }}
      />,
    );
    expect(screen.getByTestId("files")).toHaveAttribute(
      "data-worktree-id",
      "feature-auth",
    );
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() =>
      expect(screen.getByTestId("files")).toHaveAttribute(
        "data-requested-path",
        "src/auth.ts",
      ),
    );
    expect(window.location.search).toContain("worktree=feature-auth");
    expect(window.location.search).toContain("tab=changes");
    expect(window.location.search).toContain("ref=home");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Review" }));
    await waitFor(() => expect(window.location.search).toContain("tab=review"));
  });

  it("falls back to the primary checkout when a linked worktree is gone", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
        initialView={{
          worktreeId: "deleted-worktree",
          chatId: null,
          tab: null,
          file: null,
          board: false,
          terminal: false,
        }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("files")).toHaveAttribute(
        "data-worktree-id",
        "main",
      ),
    );
  });

  it("keeps a detached primary checkout in the switcher, named apart from a worktree on main", async () => {
    mocks.listWorktrees.mockResolvedValue([
      { worktreeId: "yousefs", branch: "main" },
    ]);
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    expect(
      await screen.findByRole("button", {
        name: "Active worktree: detached HEAD (primary)",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("· yousefs").length).toBeGreaterThan(0);
  });

  it("toggles between IDE stage and Workspaces Board", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    await screen.findByRole("button", { name: "Switch to Board" });
    fireEvent.click(screen.getByRole("button", { name: "Switch to Board" }));
    expect(
      screen.getByRole("region", { name: "Workspaces triage board" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Workspaces Board" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("board-card-feature-auth"));
    expect(
      screen.queryByRole("region", { name: "Workspaces triage board" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("files")).toHaveAttribute(
      "data-worktree-id",
      "feature-auth",
    );
  });

  it("renders active worktree dropdown and prominent New Chat button", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    expect(await screen.findByText("Active worktree")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New Chat" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Recent chats")).toBeInTheDocument();
  });

  it("shows only connected AI providers (e.g. Codex) with their recent chats and real logo", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    // Codex is connected in mock; Claude and Cursor are disconnected
    expect(await screen.findByText("Codex")).toBeInTheDocument();
    expect(screen.getAllByText("Initial Workspace Session")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Rename Initial Workspace Session" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 msgs")).toBeInTheDocument();

    // Disconnected providers should NOT be rendered
    expect(screen.queryByText("Claude")).not.toBeInTheDocument();
    expect(screen.queryByText("Cursor")).not.toBeInTheDocument();
  });

  it("shows a connected Cursor subscription in the workspace provider picker", async () => {
    mocks.cursorConnected = true;
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "New Chat" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "New Chat" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cursor" }));
    await waitFor(() =>
      expect(screen.getByTestId("chat-panel")).toHaveAttribute(
        "data-provider",
        "cursor",
      ),
    );
  });

  it("keeps each chat under the agent it started with when another agent starts a chat", async () => {
    mocks.cursorConnected = true;
    mocks.initialChatProvider = "codex";
    const { container } = render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    const group = (name: string) =>
      [...container.querySelectorAll(".gen2-sidebar-provider-group")].find(
        (element) =>
          element.querySelector(".gen2-sidebar-provider-name")?.textContent ===
          name,
      );
    await waitFor(() =>
      expect(group("Codex")?.textContent).toContain(
        "Initial Workspace Session",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "New Chat" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cursor" }));

    await waitFor(() =>
      expect(group("Cursor")?.textContent).toContain("New Chat"),
    );
    expect(group("Codex")?.textContent).toContain("Initial Workspace Session");
    expect(group("Cursor")?.textContent).not.toContain(
      "Initial Workspace Session",
    );
    const create = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/chats") && init?.method === "POST",
      );
    expect(JSON.parse(String(create?.[1]?.body))).toEqual({
      provider: "cursor",
    });
  });

  it("renames a chat after the server accepts the title", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Rename Initial Workspace Session",
      }),
    );
    const input = screen.getByRole("textbox", { name: "Chat title" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getAllByText("Initial Workspace Session")).toHaveLength(2);

    fireEvent.click(
      screen.getByRole("button", { name: "Rename Initial Workspace Session" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Chat title" }), {
      target: { value: "Auth notes" },
    });
    fireEvent.submit(
      screen.getByRole("textbox", { name: "Chat title" }).closest("form")!,
    );
    expect(await screen.findAllByText("Auth notes")).toHaveLength(2);
    expect(
      screen.queryByText("Initial Workspace Session"),
    ).not.toBeInTheDocument();
  });

  it("keeps the current title when a rename is rejected", async () => {
    mocks.renameOk = false;
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Rename Initial Workspace Session",
      }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Chat title" }), {
      target: { value: "Auth notes" },
    });
    fireEvent.submit(
      screen.getByRole("textbox", { name: "Chat title" }).closest("form")!,
    );
    expect(
      await screen.findByText("Couldn't rename that chat."),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Chat title" })).toHaveValue(
      "Auth notes",
    );
    expect(screen.getAllByText("Initial Workspace Session")).toHaveLength(1);
  });

  it("minimizes the sidebar to a compact rail without hiding worktree switcher and new chat", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    expect(await screen.findByText("Active worktree")).toBeInTheDocument();
    expect(screen.getByText("Recent chats")).toBeInTheDocument();

    // Minimize sidebar
    fireEvent.click(screen.getByRole("button", { name: "Minimize sidebar" }));

    // In compact/minimized rail:
    expect(screen.queryByText("Active worktree")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent chats")).not.toBeInTheDocument();
    // New chat button is still available
    expect(
      screen.getByRole("button", { name: "New Chat" }),
    ).toBeInTheDocument();
    // Worktree button is still available
    expect(
      screen.getByRole("button", { name: /Active worktree/ }),
    ).toBeInTheDocument();
    // Expand sidebar button is available in topbar
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();

    // Expand sidebar back
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(await screen.findByText("Active worktree")).toBeInTheDocument();
    expect(screen.getByText("Recent chats")).toBeInTheDocument();
  });

  it("shows an AlertDialog when switching worktrees with unsaved changes", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    // Mark as dirty
    fireEvent.click(screen.getByTestId("make-dirty"));

    // Attempt to switch branch
    const featureBranch = await screen.findByRole("button", {
      name: /feature\/auth/,
    });
    fireEvent.click(featureBranch);

    // AlertDialog should appear
    expect(screen.getByText("Unsaved Changes")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Keep Editing" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Discard & Switch" }),
    ).toBeInTheDocument();

    // Cancel keeps changes and does not switch
    fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
    expect(screen.queryByText("Unsaved Changes")).not.toBeInTheDocument();
    expect(screen.getByTestId("files")).toHaveAttribute(
      "data-worktree-id",
      "main",
    );

    // Click again and confirm discard
    fireEvent.click(featureBranch);
    expect(screen.getByText("Unsaved Changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard & Switch" }));
    expect(screen.getByTestId("files")).toHaveAttribute(
      "data-worktree-id",
      "feature-auth",
    );
  });

  it("auto-collapses the sidebar below 1280px and the inspector below 1024px", async () => {
    stubMatchMedia(
      (query) =>
        query === GEN2_SIDEBAR_COLLAPSE_QUERY ||
        query === GEN2_INSPECTOR_COLLAPSE_QUERY,
    );

    const { container } = render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );

    await screen.findByRole("button", { name: "New Chat" });
    const shell = container.querySelector(".gen2-ide-container");
    expect(shell).toHaveAttribute("data-sidebar-collapsed", "true");
    expect(shell).toHaveAttribute("data-inspector-collapsed", "true");
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand inspector" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Active worktree")).not.toBeInTheDocument();
  });

  it("lets the user expand auto-collapsed panels", async () => {
    stubMatchMedia(
      (query) =>
        query === GEN2_SIDEBAR_COLLAPSE_QUERY ||
        query === GEN2_INSPECTOR_COLLAPSE_QUERY,
    );

    const { container } = render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );

    await screen.findByRole("button", { name: "Expand sidebar" });
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(await screen.findByText("Active worktree")).toBeInTheDocument();
    expect(container.querySelector(".gen2-ide-container")).toHaveAttribute(
      "data-sidebar-collapsed",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand inspector" }));
    expect(container.querySelector(".gen2-ide-container")).toHaveAttribute(
      "data-inspector-collapsed",
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Collapse inspector" }),
    ).toBeInTheDocument();
  });
  it("wakes a sleeping workspace when the page opens", async () => {
    mocks.connected = false;
    const { ensureGen2WorkspaceReady } =
      await import("@/lib/gen2/startup-client");
    render(
      <SupersetWorkspaceShell
        workspaceId="e010bd2c-a3c1-438f-acef-166287a3b1cb"
        canEdit
        runtimeEnabled
      />,
    );
    await waitFor(() => expect(ensureGen2WorkspaceReady).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.queryByText("This workspace is asleep"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Reconnect workspace" }),
    ).not.toBeInTheDocument();
    // The top bar reports the checked connection, never a stale persisted state.
    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
  });

  it("shows the Browser tab only where previews are enabled", async () => {
    const { unmount } = render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    expect(screen.queryByRole("tab", { name: "Browser" })).toBeNull();
    expect(screen.queryByTestId("browser-pane")).toBeNull();
    unmount();

    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
        previewEnabled
      />,
    );
    expect(screen.getByTestId("browser-pane")).toHaveAttribute(
      "data-visible",
      "false",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Agent opens a preview" }),
    );
    expect(await screen.findByRole("tab", { name: "Browser" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("browser-pane")).toHaveAttribute(
      "data-visible",
      "true",
    );
    expect(screen.getByTestId("browser-pane")).toHaveAttribute(
      "data-port",
      "3000",
    );
    // The pane sits inside the agent context, like the chat.
    expect(screen.getByTestId("browser-pane")).toHaveAttribute(
      "data-has-agent",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand preview" }));
    expect(mocks.expandPreview).toHaveBeenCalledWith(true, true, "75%");
  });

  it("opens another run's worktree from the chat, even one made since load", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    await screen.findByRole("button", { name: /feature\/auth/ });
    const reads = mocks.listWorktrees.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Open the other run" }));
    expect(screen.getByTestId("files")).toHaveAttribute(
      "data-worktree-id",
      "run-7",
    );
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(mocks.listWorktrees.mock.calls.length).toBeGreaterThan(reads);
  });

  it("never opens the discard dialog for an agent's switch", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    await screen.findByRole("button", { name: /feature\/auth/ });
    fireEvent.click(screen.getByTestId("make-dirty"));
    fireEvent.click(
      screen.getByRole("button", { name: "Agent switches worktree" }),
    );
    expect(await screen.findByTestId("action-result")).toHaveTextContent(
      "You have unsaved changes. Save or discard them, then try again.",
    );
    expect(screen.queryByText("Unsaved Changes")).not.toBeInTheDocument();
    expect(screen.getByTestId("files")).toHaveAttribute(
      "data-worktree-id",
      "main",
    );
  });

  it("opens files the chat names through the workspace controller", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Chat opens a file" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.getByTestId("files")).toHaveAttribute(
      "data-requested-path",
      "src/login.ts",
    );
  });

  it("runs an accepted command in a terminal tab of its own", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    expect(screen.queryByRole("tablist", { name: "Terminals" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Agent runs a command" }),
    );
    expect(
      await screen.findByRole("tablist", { name: "Terminals" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Collapse terminal")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "npm test" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getAllByTestId("terminal")).toHaveLength(2);
    // The tab strip is a real tablist: arrow keys move between sessions.
    fireEvent.keyDown(screen.getByRole("tab", { name: "npm test" }), {
      key: "ArrowLeft",
    });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Shell" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close npm test" }));
    expect(screen.queryByRole("tablist", { name: "Terminals" })).toBeNull();
    expect(screen.getAllByTestId("terminal")).toHaveLength(1);
  });
});

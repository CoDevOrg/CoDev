import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listWorktrees: vi.fn(),
  createWorktree: vi.fn(),
}));

vi.mock("./superset-file-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./superset-file-client")>()),
  listSupersetWorktrees: mocks.listWorktrees,
  createSupersetWorktree: mocks.createWorktree,
}));

vi.mock("./superset-file-pane", () => ({
  SupersetFilePane: ({ worktreeId }: { worktreeId?: string }) => (
    <div data-testid="files" data-worktree-id={worktreeId} />
  ),
}));

vi.mock("./terminal-pane", () => ({
  Gen2TerminalPane: ({ worktreeId }: { worktreeId?: string }) => (
    <div data-testid="terminal" data-worktree-id={worktreeId} />
  ),
}));

vi.mock("./chat-panel", () => ({
  Gen2ChatPanel: ({ worktreeId }: { worktreeId?: string }) => (
    <div data-testid="chat-panel" data-worktree-id={worktreeId} />
  ),
}));

vi.mock("@/lib/gen2/startup-client", () => ({
  ensureGen2WorkspaceReady: vi.fn().mockResolvedValue({
    workspace: {
      id: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
      status: "ready",
      sandboxId: "sb-1",
    },
  }),
}));

import { SupersetWorkspaceShell } from "./superset-workspace-shell";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";

describe("SupersetWorkspaceShell", () => {
  beforeEach(() => {
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
        if (urlStr.includes("/api/gen2/providers")) {
          return Promise.resolve(
            Response.json({
              codex: { connected: true, via: "api-key" },
              claude: { connected: false, via: null },
              cursor: { connected: false, via: null },
            }),
          );
        }
        if (urlStr.includes("/chats") && init?.method === "POST") {
          return Promise.resolve(
            Response.json({
              chat: {
                id: "chat-new",
                title: "New Chat",
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

    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
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

  it("lets editors create and select a Superset-owned worktree", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    await screen.findByRole("button", { name: "New branch" });
    fireEvent.click(screen.getByRole("button", { name: "New branch" }));
    fireEvent.change(screen.getByLabelText("Worktree ID"), {
      target: { value: "fix-login" },
    });
    fireEvent.change(screen.getByLabelText("Branch"), {
      target: { value: "fix/login" },
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
    expect(await screen.findByText("ACTIVE WORKTREE")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New Chat" }),
    ).toBeInTheDocument();
    expect(screen.getByText("RECENT CHATS")).toBeInTheDocument();
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
    expect(screen.getByText("1 msgs")).toBeInTheDocument();

    // Disconnected providers should NOT be rendered
    expect(screen.queryByText("Claude")).not.toBeInTheDocument();
    expect(screen.queryByText("Cursor")).not.toBeInTheDocument();
  });

  it("minimizes the sidebar to a compact rail without hiding worktree switcher and new chat", async () => {
    render(
      <SupersetWorkspaceShell
        workspaceId={workspaceId}
        canEdit
        runtimeEnabled
      />,
    );
    expect(await screen.findByText("ACTIVE WORKTREE")).toBeInTheDocument();
    expect(screen.getByText("RECENT CHATS")).toBeInTheDocument();

    // Minimize sidebar
    fireEvent.click(screen.getByRole("button", { name: "Minimize sidebar" }));

    // In compact/minimized rail:
    expect(screen.queryByText("ACTIVE WORKTREE")).not.toBeInTheDocument();
    expect(screen.queryByText("RECENT CHATS")).not.toBeInTheDocument();
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
    expect(await screen.findByText("ACTIVE WORKTREE")).toBeInTheDocument();
    expect(screen.getByText("RECENT CHATS")).toBeInTheDocument();
  });
});

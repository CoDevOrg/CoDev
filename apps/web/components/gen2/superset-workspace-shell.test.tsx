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
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ output: "## feature/auth\n M src/login.ts\n" }),
        ),
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
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "feature/auth" }),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("Selected branch worktree"), {
      target: { value: "feature-auth" },
    });
    expect(screen.getByTestId("files")).toHaveAttribute(
      "data-worktree-id",
      "feature-auth",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    expect(await screen.findByText("src/login.ts")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    expect(screen.getByTestId("terminal")).toHaveAttribute(
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
});

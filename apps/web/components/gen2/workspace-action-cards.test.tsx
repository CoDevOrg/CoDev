import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  Gen2WorkspaceAction,
  Gen2WorkspaceContext,
} from "@codev/contracts";

import type { PendingWorkspaceAction } from "./use-workspace-action-dispatch";
import { WorkspaceActionCards } from "./workspace-action-cards";
import {
  WorkspaceAgentContext,
  type WorkspaceActionResult,
  type WorkspaceAgentContextValue,
} from "./workspace-controller";

const SNAPSHOT = {
  worktree: {
    id: "feat-a",
    branch: "feat/a",
    changedFiles: 2,
    unsavedEdits: false,
  },
  worktrees: [
    { id: "main", branch: "main" },
    { id: "feat-a", branch: "feat/a" },
  ],
} as Gen2WorkspaceContext;

function pending(
  key: string,
  action: Gen2WorkspaceAction,
  blocker: string | null = "Waits for you to confirm",
): PendingWorkspaceAction {
  return { key, chatId: "chat-1", action, blocker };
}

function renderCards(
  entries: PendingWorkspaceAction[],
  {
    canEdit = true,
    result = { ok: true, message: "Done" } as WorkspaceActionResult,
  } = {},
) {
  const run = vi.fn<
    (action: Gen2WorkspaceAction) => Promise<WorkspaceActionResult>
  >(async () => result);
  const onResolve = vi.fn();
  const value = {
    controller: { run, autoRunBlocker: () => null },
    getSnapshot: () => SNAPSHOT,
    canEdit,
    sources: { worktreeId: "feat-a", activeChatId: "chat-1" },
  } as unknown as WorkspaceAgentContextValue;
  const view = render(
    <WorkspaceAgentContext.Provider value={value}>
      <WorkspaceActionCards pending={entries} onResolve={onResolve} />
    </WorkspaceAgentContext.Provider>,
  );
  return { run, onResolve, ...view };
}

const invite: Gen2WorkspaceAction = {
  type: "invite_members",
  people: ["ada", "nobody"],
  role: "editor",
};

describe("WorkspaceActionCards", () => {
  it("shows the first three requests with their position and exact effect", () => {
    renderCards([
      pending("a", invite),
      pending("b", { type: "create_branch", branch: "feat/b" }),
      pending("c", { type: "run_in_terminal", command: "npm run dev" }),
      pending("d", { type: "open_settings" }),
    ]);
    expect(screen.getAllByRole("region")).toHaveLength(3);
    expect(screen.getByText("Agent request · 1 of 4")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Adds ada, nobody as editor now — immediate access to code, terminals and agents.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Create feat/b from feat/a in a new worktree and switch to it. Uncommitted changes stay on feat/a.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("npm run dev")).toBeInTheDocument();
    for (const label of ["Send invites", "Create branch", "Run in terminal"]) {
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
    }
  });

  it("acts only on a click and keeps per-person results until closed", async () => {
    const { run, onResolve } = renderCards([pending("a", invite)], {
      result: {
        ok: true,
        message: "Invited 1 · 1 needs an invite link",
        details: [
          { person: "ada", ok: true, message: "Added as editor" },
          { person: "nobody", ok: false, message: "No CoDev account" },
        ],
      },
    });
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send invites" }));
    await waitFor(() =>
      expect(onResolve).toHaveBeenCalledWith(
        "a",
        "done",
        "Invited 1 · 1 needs an invite link",
      ),
    );
    expect(run).toHaveBeenCalledWith(invite);
    expect(screen.getByText("Added as editor")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open Share to copy the invite link",
      }),
    );
    expect(run).toHaveBeenLastCalledWith({
      type: "open_share",
      emailOrLogin: "nobody",
    });
  });

  it("keeps a failed request open with its reason, and dismisses on request", async () => {
    const { onResolve } = renderCards(
      [pending("a", { type: "open_branch", branch: "feat/x" })],
      { result: { ok: false, message: "Run git fetch origin first." } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Open branch" }));
    expect(
      await screen.findByText("Run git fetch origin first."),
    ).toBeInTheDocument();
    expect(onResolve).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss request to open feat/x" }),
    );
    expect(onResolve).toHaveBeenCalledWith("a", "dismissed");
  });

  it("offers to switch first for a command meant for another worktree", async () => {
    const command = {
      type: "run_in_terminal",
      command: "pnpm test",
      worktreeId: "main",
    } as const;
    const { run } = renderCards([pending("a", command)]);
    expect(
      screen.getByText(
        "Runs on main. Its terminal tab appears when you switch there.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch and run" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls.map(([action]) => action)).toEqual([
      { type: "switch_worktree", worktreeId: "main" },
      command,
    ]);
  });

  it("shows viewers the request without letting them act", () => {
    renderCards([pending("a", invite)], { canEdit: false });
    expect(screen.getByRole("button", { name: "Send invites" })).toBeDisabled();
    expect(
      screen.getByText("Only editors can act on agent requests."),
    ).toBeInTheDocument();
  });
});

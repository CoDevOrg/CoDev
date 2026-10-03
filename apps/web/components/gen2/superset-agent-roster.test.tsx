import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupersetAgentRoster } from "./superset-agent-roster";

const run = {
  id: "run-1",
  chatId: "chat-1",
  createdBy: "member-1",
  worktreeId: "agent-one",
  provider: "codex",
  status: "running" as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  canInput: true,
  canCancel: true,
  canRecover: false,
};

describe("SupersetAgentRoster", () => {
  const onSelectWorktree = vi.fn();
  const onStart = vi.fn().mockResolvedValue(undefined);
  const onChanged = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            chunks: [{ sequence: 1, text: "Working on the branch" }],
          }),
        ),
      ),
    );
  });

  it("shows safe progress and only server-permitted controls", async () => {
    render(
      <SupersetAgentRoster
        workspaceId="workspace-1"
        runs={[run]}
        members={[
          {
            userId: "member-1",
            login: "ada",
            name: "Ada",
            email: null,
            avatarUrl: null,
            role: "editor",
          },
        ]}
        branches={{ "agent-one": "feature/agent-one" }}
        canStart
        provider="codex"
        onSelectWorktree={onSelectWorktree}
        onStart={onStart}
        onChanged={onChanged}
      />,
    );

    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByLabelText("Status: Working")).toBeInTheDocument();
    expect(
      await screen.findByText("Working on the branch"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recover" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Start agent" }));
    fireEvent.change(screen.getByLabelText("New codex agent"), {
      target: { value: "Check the test suite" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Start agent" })[1]!);
    await waitFor(() =>
      expect(onStart).toHaveBeenCalledWith("Check the test suite", "codex"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Open branch" }));
    expect(onSelectWorktree).toHaveBeenCalledWith("agent-one");

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/gen2/workspaces/workspace-1/superset/agents/run-1",
      { method: "DELETE" },
    );
  });
});

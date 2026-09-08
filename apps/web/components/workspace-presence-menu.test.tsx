import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspacePresenceMenu } from "./workspace-presence-menu";

const fetchTeamRoster = vi.fn();

vi.mock("@/lib/team-chat-client", () => ({
  fetchTeamRoster: (...args: unknown[]) => fetchTeamRoster(...args),
}));

describe("WorkspacePresenceMenu", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("expands the roster, opens Team room, and returns focus on Escape", async () => {
    fetchTeamRoster.mockResolvedValue({
      viewerId: "user-1",
      members: [
        {
          user: { id: "user-1", login: "qais", name: "Qais", avatarUrl: null },
          accessRole: "workspace_owner",
          isViewer: true,
          online: true,
          headline: "Reviewing agent work",
          emoji: null,
          activePath: null,
          agentTask: null,
          agentProvider: null,
        },
      ],
      agents: [
        {
          sessionId: "session-1",
          name: "Codex",
          provider: "codex",
          status: "working",
          currentTask: "Improve the workspace",
          owner: "Qais",
        },
      ],
    });
    const onOpenTeamRoom = vi.fn();
    render(
      <WorkspacePresenceMenu
        workspaceId="workspace-1"
        activeAgentCount={1}
        onOpenTeamRoom={onOpenTeamRoom}
      />,
    );

    const trigger = await screen.findByRole("button", {
      name: "1 people here, 1 active agent sessions",
    });
    fireEvent.click(trigger);
    expect(
      screen.getByRole("dialog", { name: "People in this workspace" }),
    ).toBeTruthy();
    expect(screen.getByText(/Reviewing agent work/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Team room" }));
    expect(onOpenTeamRoom).toHaveBeenCalledOnce();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(
      screen.queryByRole("dialog", { name: "People in this workspace" }),
    ).toBeNull();
  });
});

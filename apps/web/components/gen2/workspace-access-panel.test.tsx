import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Gen2WorkspaceDetail } from "@codev/contracts";

import { Gen2WorkspaceAccessPanel } from "./workspace-access-panel";

const workspace: Gen2WorkspaceDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Studio",
  repository: null,
  status: "ready",
  sandboxId: "sandbox",
  lastError: null,
  role: "owner",
  capabilities: {
    "workspace.view": true,
    "workspace.editFiles": true,
    "workspace.useTerminal": true,
    "instance.start": true,
    "instance.stop": true,
    "agent.run": true,
    "agent.cancelOwn": true,
    "agent.cancelAny": true,
    "context.view": true,
    "context.includeInTurn": true,
    "member.invite": true,
    "member.changeRole": true,
    "member.remove": true,
    "workspace.managePolicy": true,
    "connection.manageOwn": true,
    "connection.viewStatus": true,
  },
  createdAt: "2026-09-20T20:00:00.000Z",
  updatedAt: "2026-09-20T20:00:00.000Z",
  activeInvite: { active: false, expiresAt: null },
  members: [
    {
      userId: "22222222-2222-4222-8222-222222222222",
      login: "ada",
      name: "Ada",
      role: "owner",
    },
    {
      userId: "33333333-3333-4333-8333-333333333333",
      login: "lin",
      name: "Lin",
      role: "editor",
    },
  ],
};

function renderPanel(input = workspace) {
  const onWorkspaceChange = vi.fn();
  render(
    <Gen2WorkspaceAccessPanel
      onClose={vi.fn()}
      onWorkspaceChange={onWorkspaceChange}
      workspace={input}
    />,
  );
  return onWorkspaceChange;
}

describe("Gen2WorkspaceAccessPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("shows every member and exposes owner-only mutation controls", () => {
    renderPanel();

    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Lin")).toBeInTheDocument();
    expect(screen.getByLabelText("Role for Lin")).toHaveValue("editor");
    expect(screen.getByLabelText("Remove Lin")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create link" }),
    ).toBeInTheDocument();
  });

  it("does not render mutation controls for a viewer", () => {
    renderPanel({
      ...workspace,
      role: "viewer",
      capabilities: {
        ...workspace.capabilities,
        "member.invite": false,
        "member.changeRole": false,
        "member.remove": false,
      },
    });

    expect(screen.getByText("editor")).toBeInTheDocument();
    expect(screen.queryByLabelText("Role for Lin")).toBeNull();
    expect(screen.queryByLabelText("Remove Lin")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create link" })).toBeNull();
  });

  it("updates a member role through the capability-protected API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              member: { userId: workspace.members[1]!.userId, role: "viewer" },
            }),
          ),
      ),
    );
    const onWorkspaceChange = renderPanel();

    fireEvent.change(screen.getByLabelText("Role for Lin"), {
      target: { value: "viewer" },
    });

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/gen2/workspaces/${workspace.id}/members/${workspace.members[1]!.userId}`,
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    expect(onWorkspaceChange).toHaveBeenCalledWith(
      expect.objectContaining({
        members: expect.arrayContaining([
          expect.objectContaining({
            userId: workspace.members[1]!.userId,
            role: "viewer",
          }),
        ]),
      }),
    );
  });

  it("creates and copies an invite link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/share")) {
          return new Response(
            JSON.stringify({ inviteUrl: "https://codev.test/gen2/join/token" }),
          );
        }
        return new Response(
          JSON.stringify({
            workspace: {
              ...workspace,
              activeInvite: {
                active: true,
                expiresAt: "2026-09-29T20:00:00.000Z",
              },
            },
          }),
        );
      }),
    );
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Create link" }));

    expect(await screen.findByLabelText("Invite link")).toHaveValue(
      "https://codev.test/gen2/join/token",
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "https://codev.test/gen2/join/token",
    );
  });
});

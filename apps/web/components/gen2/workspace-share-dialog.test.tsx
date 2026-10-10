import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Gen2WorkspaceMember } from "@codev/contracts";

import { WorkspaceShareDialog } from "./workspace-share-dialog";

function openMemberMenu(login: string) {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: `More actions for ${login}` }),
    { button: 0, ctrlKey: false },
  );
}

const initialMembers: Gen2WorkspaceMember[] = [
  {
    userId: "user-1",
    login: "alice",
    name: "Alice Owner",
    email: "alice@example.com",
    role: "owner",
  },
  {
    userId: "user-2",
    login: "bob",
    name: "Bob Editor",
    email: "bob@example.com",
    role: "editor",
  },
  {
    userId: "user-3",
    login: "carol",
    name: "Carol Viewer",
    email: "carol@example.com",
    role: "viewer",
  },
];

describe("WorkspaceShareDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes("/members") && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              members: [
                ...initialMembers,
                {
                  userId: "user-4",
                  login: "dave",
                  name: "Dave",
                  email: "dave@example.com",
                  role: "viewer",
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (urlStr.includes("/members/user-2") && init?.method === "PATCH") {
          return new Response(
            JSON.stringify({
              members: initialMembers.map((m) =>
                m.userId === "user-2" ? { ...m, role: "viewer" } : m,
              ),
            }),
            { status: 200 },
          );
        }
        if (urlStr.includes("/members/user-3") && init?.method === "DELETE") {
          return new Response(
            JSON.stringify({
              members: initialMembers.filter((m) => m.userId !== "user-3"),
            }),
            { status: 200 },
          );
        }
        if (urlStr.includes("/members")) {
          return new Response(
            JSON.stringify({
              members: initialMembers,
              ownerId: "user-1",
            }),
            { status: 200 },
          );
        }
        if (urlStr.includes("/share")) {
          return new Response(
            JSON.stringify({
              inviteUrl: "https://codev.test/gen2/join/test-token",
              role: "editor",
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
  });

  it("renders the share dialog with workspace name, members, and link access", async () => {
    render(
      <WorkspaceShareDialog
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-123"
        workspaceName="Frontend Redesign"
        currentUserRole="owner"
        currentUserId="user-1"
        initialMembers={initialMembers}
      />,
    );

    expect(screen.getByText("Share “Frontend Redesign”")).toBeInTheDocument();
    expect(screen.getByText(/Alice Owner/)).toBeInTheDocument();
    expect(screen.getByText("(you)")).toBeInTheDocument();
    expect(screen.getByText("Bob Editor")).toBeInTheDocument();
    expect(screen.getByText("Carol Viewer")).toBeInTheDocument();
    expect(screen.getByText("Anyone with the link")).toBeInTheDocument();
    // Counts that restate the visible list are omitted (design contract §6).
    expect(screen.queryByText("3 people")).not.toBeInTheDocument();
  });

  it("invites a new user with a chosen role", async () => {
    render(
      <WorkspaceShareDialog
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-123"
        workspaceName="Frontend Redesign"
        currentUserRole="owner"
        currentUserId="user-1"
        initialMembers={initialMembers}
      />,
    );

    const input = screen.getByLabelText("Add people by email or username");
    const roleSelect = screen.getByLabelText("Choose invite role");
    const inviteBtn = screen.getByRole("button", { name: /Invite/i });

    fireEvent.change(input, { target: { value: "dave@example.com" } });
    fireEvent.change(roleSelect, { target: { value: "viewer" } });
    fireEvent.click(inviteBtn);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/members"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            emailOrLogin: "dave@example.com",
            role: "viewer",
          }),
        }),
      );
    });

    expect(
      await screen.findByText(/Added dave@example.com as viewer/),
    ).toBeInTheDocument();
  });

  it("allows the owner to change another member's role", async () => {
    render(
      <WorkspaceShareDialog
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-123"
        workspaceName="Frontend Redesign"
        currentUserRole="owner"
        currentUserId="user-1"
        initialMembers={initialMembers}
      />,
    );

    const bobSelect = screen.getByLabelText("Change role for bob");
    expect(bobSelect).toHaveValue("editor");

    fireEvent.change(bobSelect, { target: { value: "viewer" } });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/members/user-2"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ role: "viewer" }),
        }),
      );
    });
  });

  it("allows the owner to remove a member", async () => {
    render(
      <WorkspaceShareDialog
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-123"
        workspaceName="Frontend Redesign"
        currentUserRole="owner"
        currentUserId="user-1"
        initialMembers={initialMembers}
      />,
    );

    openMemberMenu("carol");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove access…" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "The current share link also stops working",
    );
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/members/user-3"),
      expect.objectContaining({ method: "DELETE" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Remove access$/ }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/members/user-3"),
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });
    // Removing someone revokes the link on the server, so a fresh one loads.
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(([url]) => String(url).endsWith("/share")),
      ).toHaveLength(2),
    );
    expect(await screen.findByText("Removed member access.")).toBeVisible();
  });

  it("loads the reusable link without resetting its access role", async () => {
    render(
      <WorkspaceShareDialog
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-123"
        workspaceName="Group project"
        currentUserRole="owner"
        currentUserId="user-1"
        initialMembers={initialMembers}
      />,
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/gen2/workspaces/ws-123/share",
        expect.objectContaining({ method: "POST", body: "{}" }),
      ),
    );
    expect(
      screen.getByText(/Can join as the selected role/i),
    ).toBeInTheDocument();
  });

  it("copies the invite link to the clipboard", async () => {
    render(
      <WorkspaceShareDialog
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-123"
        workspaceName="Frontend Redesign"
        currentUserRole="owner"
        currentUserId="user-1"
        initialMembers={initialMembers}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Copy link/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /Copy link/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "https://codev.test/gen2/join/test-token",
      );
    });

    expect(
      await screen.findByText(/Link copied to clipboard/),
    ).toBeInTheDocument();
  });

  it("transfers ownership only after confirmation", async () => {
    render(
      <WorkspaceShareDialog
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-123"
        workspaceName="Frontend Redesign"
        currentUserRole="owner"
        currentUserId="user-1"
        initialMembers={initialMembers}
      />,
    );

    openMemberMenu("bob");
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Transfer ownership…" }),
    );
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/members/user-2"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ role: "owner" }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/members/user-2"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ role: "owner" }),
        }),
      );
    });
  });

  it("returns focus to the control that opened it", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Share workspace
          </button>
          <WorkspaceShareDialog
            open={open}
            onOpenChange={setOpen}
            workspaceId="ws-123"
            workspaceName="Frontend Redesign"
            currentUserRole="owner"
            currentUserId="user-1"
            initialMembers={initialMembers}
          />
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Share workspace" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("shows viewers who has access without invite or link controls", async () => {
    render(
      <WorkspaceShareDialog
        open={true}
        onOpenChange={vi.fn()}
        workspaceId="ws-123"
        workspaceName="Frontend Redesign"
        currentUserRole="viewer"
        currentUserId="user-3"
        initialMembers={initialMembers}
      />,
    );

    expect(screen.getByText("Bob Editor")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Add people by email or username"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Copy link/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Change role for bob"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Only editors and the owner can share a link."),
    ).toBeInTheDocument();
    const urls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    await waitFor(() =>
      expect(urls()).toContain("/api/gen2/workspaces/ws-123/members"),
    );
    expect(urls().some((url) => url.endsWith("/share"))).toBe(false);
  });
});

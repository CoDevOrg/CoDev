import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShareDialog } from "./share-dialog";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

describe("ShareDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    refresh.mockReset();
  });

  it("lets owners change a member's fine-grained role", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ShareDialog
        workspaceId="workspace-1"
        workspaceName="acme/demo"
        canShare
        isOwner
        members={[
          {
            userId: "owner-1",
            login: "owner",
            name: "Owner",
            role: "owner",
            accessRole: "owner",
          },
          {
            userId: "reviewer-1",
            login: "alex_dev",
            name: "Alex",
            role: "member",
            accessRole: "reviewer",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Permission for alex_dev" }),
      { target: { value: "viewer" } },
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/workspace-1/members/reviewer-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ accessRole: "viewer" }),
        }),
      );
    });
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("Member permissions updated.")).toBeInTheDocument();
  });

  it("closes when escape is pressed", () => {
    render(
      <ShareDialog
        workspaceId="workspace-1"
        workspaceName="acme/demo"
        canShare
        isOwner
        members={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets Co-Steer members share viewer-only invitations", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ inviteUrl: "https://codev.example/invite/viewer" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ShareDialog
        workspaceId="workspace-1"
        workspaceName="acme/demo"
        canShare
        isOwner={false}
        members={[
          {
            userId: "admin-1",
            login: "admin",
            name: "Admin",
            role: "owner",
            accessRole: "owner",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(
      screen.getByText(/People you add receive Viewer access/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Permission for new invitations"),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/alex@company.com/), {
      target: { value: "viewer@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/workspace-1/invites",
        expect.objectContaining({
          body: expect.stringContaining('"accessRole":"viewer"'),
        }),
      );
    });
  });
});

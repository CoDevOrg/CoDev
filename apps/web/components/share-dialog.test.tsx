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
        isOwner
        members={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

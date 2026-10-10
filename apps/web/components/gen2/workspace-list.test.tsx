import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Gen2Workspace } from "@codev/contracts";

import { Gen2WorkspaceList } from "./workspace-list";

const ownerWorkspace: Gen2Workspace = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Studio",
  repository: null,
  status: "ready",
  sandboxId: "sandbox-1",
  runtimeProvider: "firecracker",
  runtimeStatus: "ready",
  runtimeGeneration: 0,
  lastError: null,
  role: "owner",
  createdAt: "2026-09-20T20:00:00.000Z",
  updatedAt: "2026-09-20T20:00:00.000Z",
};

describe("Gen2WorkspaceList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
  });

  it("confirms permanent deletion with a press-and-hold and reports it", async () => {
    const onDeleted = vi.fn();
    render(
      <Gen2WorkspaceList workspaces={[ownerWorkspace]} onDeleted={onDeleted} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete Studio" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "permanently deletes the workspace",
    );
    // Deleting needs a full press-and-hold, not a click.
    const hold = screen.getByRole("button", {
      name: "Hold to delete workspace",
    });
    fireEvent.click(hold);
    expect(fetch).not.toHaveBeenCalled();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.keyDown(hold, { key: "Enter" });
    act(() => {
      vi.advanceTimersByTime(1_600);
    });
    vi.useRealTimers();

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/gen2/workspaces/${ownerWorkspace.id}`,
        { method: "DELETE" },
      ),
    );
    await waitFor(() =>
      expect(onDeleted).toHaveBeenCalledWith(ownerWorkspace, false),
    );
  });

  it("shows interrupted deletion as retryable and not openable", () => {
    const deletingWorkspace = {
      ...ownerWorkspace,
      status: "deleting" as const,
      lastError: "Deletion did not finish.",
    };
    render(<Gen2WorkspaceList workspaces={[deletingWorkspace]} />);

    expect(screen.getByText("Deleting")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Studio/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Retry deletion of Studio" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Deletion did not finish. Retry deletion to continue.",
    );
  });

  it("labels a stopping workspace and blocks deleting it mid-change", () => {
    render(
      <Gen2WorkspaceList
        workspaces={[
          {
            ...ownerWorkspace,
            runtimeProvider: "azure_arm",
            status: "provisioning",
            runtimeStatus: "stopping",
          },
        ]}
      />,
    );

    expect(screen.getByText("Stopping")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete Studio" }),
    ).toBeDisabled();
  });

  it("names each member's role and lists newest activity first", () => {
    render(
      <Gen2WorkspaceList
        viewMode="grid"
        workspaces={[
          ownerWorkspace,
          {
            ...ownerWorkspace,
            id: "33333333-3333-4333-8333-333333333333",
            name: "Shared docs",
            role: "viewer",
            updatedAt: "2026-09-22T20:00:00.000Z",
          },
        ]}
      />,
    );

    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveTextContent("Shared docs");
    expect(links[0]).toHaveTextContent("Viewer");
    expect(links[1]).toHaveTextContent("Owner");
    expect(
      screen.queryByRole("button", { name: "Delete Shared docs" }),
    ).toBeNull();
  });
});

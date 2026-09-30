import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import type { Gen2Workspace } from "@codev/contracts";

import { Gen2WorkspaceList } from "./workspace-list";

const ownerWorkspace: Gen2Workspace = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Studio",
  repository: null,
  status: "ready",
  sandboxId: "sandbox-1",
  lastError: null,
  role: "owner",
  createdAt: "2026-09-20T20:00:00.000Z",
  updatedAt: "2026-09-20T20:00:00.000Z",
};

function workspaceNamed(name: string, overrides: Partial<Gen2Workspace> = {}) {
  return {
    ...ownerWorkspace,
    id: `id-${name}`,
    name,
    ...overrides,
  } satisfies Gen2Workspace;
}

describe("Gen2WorkspaceList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
  });

  it("deletes only after an in-app confirmation that names what is lost", async () => {
    render(<Gen2WorkspaceList workspaces={[ownerWorkspace]} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Studio" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete workspace" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("all saved files");
    expect(dialog).toHaveTextContent("every chat and its history");
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete workspace" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/gen2/workspaces/${ownerWorkspace.id}`,
        { method: "DELETE" },
      ),
    );
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(screen.getByText("No workspaces yet")).toBeInTheDocument();
  });

  it("keeps the workspace when the confirmation is cancelled", () => {
    render(<Gen2WorkspaceList workspaces={[ownerWorkspace]} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Studio" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText("Studio")).toBeInTheDocument();
  });

  it("offers no actions on a workspace shared with you", () => {
    render(
      <Gen2WorkspaceList
        workspaces={[workspaceNamed("Team", { role: "editor" })]}
      />,
    );
    expect(screen.getByText("Shared with you")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Actions for/ })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Actions for Studio" }));
    expect(
      screen.getByRole("menuitem", { name: "Retry deletion" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Deletion did not finish. Retry deletion to continue.",
    );
  });

  it("tells not-started and stopped workspaces apart", () => {
    render(
      <Gen2WorkspaceList
        workspaces={[
          workspaceNamed("Fresh", { status: "pending" }),
          workspaceNamed("Paused", { status: "stopped" }),
        ]}
      />,
    );
    expect(screen.getByText("Not started")).toBeInTheDocument();
    expect(screen.getByText("Stopped")).toBeInTheDocument();
  });

  it("explains the empty state and points at the create form", () => {
    render(<Gen2WorkspaceList workspaces={[]} />);
    expect(screen.getByText("No workspaces yet")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Create your first workspace" }),
    ).toHaveAttribute("href", "#new-workspace");
  });

  it("adds search and sort once there are several workspaces", () => {
    const few = [workspaceNamed("A"), workspaceNamed("B")];
    const { unmount } = render(<Gen2WorkspaceList workspaces={few} />);
    expect(screen.queryByLabelText("Search workspaces")).toBeNull();
    unmount();

    render(
      <Gen2WorkspaceList
        workspaces={[
          workspaceNamed("Zulu", { updatedAt: "2026-09-29T00:00:00.000Z" }),
          workspaceNamed("Alpha", { updatedAt: "2026-09-01T00:00:00.000Z" }),
          workspaceNamed("Mike", { updatedAt: "2026-09-15T00:00:00.000Z" }),
          workspaceNamed("Echo", { updatedAt: "2026-09-10T00:00:00.000Z" }),
        ]}
      />,
    );
    const names = () =>
      screen.getAllByRole("link").map((link) => link.textContent);
    expect(names()[0]).toContain("Zulu");

    fireEvent.change(screen.getByLabelText("Sort workspaces"), {
      target: { value: "name" },
    });
    expect(names()[0]).toContain("Alpha");

    fireEvent.change(screen.getByLabelText("Search workspaces"), {
      target: { value: "mik" },
    });
    expect(screen.getAllByRole("link")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Search workspaces"), {
      target: { value: "nothing" },
    });
    expect(screen.getByText(/No workspaces match/)).toBeInTheDocument();
  });
});

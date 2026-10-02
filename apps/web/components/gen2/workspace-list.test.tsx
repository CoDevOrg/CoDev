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

describe("Gen2WorkspaceList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
  });

  it("confirms permanent deletion and refreshes the owner count", async () => {
    render(<Gen2WorkspaceList workspaces={[ownerWorkspace]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Studio" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/gen2/workspaces/${ownerWorkspace.id}`,
        { method: "DELETE" },
      ),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("permanently deletes the workspace"),
    );
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(screen.getByText("No workspaces yet.")).toBeInTheDocument();
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
});

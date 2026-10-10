import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import type { Gen2HomeSnapshot, Gen2Workspace } from "@codev/contracts";
import { Gen2WorkspaceDashboard } from "./workspace-dashboard";

const mockWorkspace: Gen2Workspace = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Design System",
  repository: {
    fullName: "codev/design",
    private: false,
    defaultBranch: "main",
  },
  status: "ready",
  sandboxId: "sandbox-2",
  runtimeProvider: "firecracker",
  runtimeStatus: "ready",
  runtimeGeneration: 0,
  lastError: null,
  role: "owner",
  createdAt: "2026-09-21T12:00:00.000Z",
  updatedAt: "2026-09-21T12:00:00.000Z",
};

function snapshot(
  workspaces: Gen2Workspace[],
  overrides: Partial<Gen2HomeSnapshot["compute"]> = {},
): Gen2HomeSnapshot {
  return {
    workspaces,
    compute: {
      minutesUsed: 754,
      minutesLimit: 3000,
      unlimited: false,
      resetsAt: "2026-11-01T00:00:00.000Z",
      tier: "free",
      freeEnabled: true,
      ownedWorkspaceCount: workspaces.filter((item) => item.role === "owner")
        .length,
      workspaceLimit: 2,
      activeWorkspaceLimit: 1,
      armBootMinutesCount: true,
      budget: null,
      ...overrides,
    },
  };
}

function renderDashboard(initialSnapshot: Gen2HomeSnapshot) {
  return render(
    <Gen2WorkspaceDashboard
      user={{ name: "Yousef Maher" }}
      github={{ connected: true, login: "yousef20920" }}
      initialSnapshot={initialSnapshot}
    />,
  );
}

describe("Gen2WorkspaceDashboard", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("greets the member by name and summarizes their workspaces", () => {
    renderDashboard(snapshot([mockWorkspace]));

    expect(screen.getByText("Workspace home")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /, Yousef$/,
    );
    const summary = screen.getByRole("region", { name: "Workspace summary" });
    expect(within(summary).getByText("Running now")).toBeInTheDocument();
    expect(within(summary).getByText("37h 26m left")).toBeInTheDocument();
    expect(within(summary).getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "@yousef20920" })).toHaveAttribute(
      "href",
      "/settings/personal/integrations",
    );
  });

  it("filters workspaces using search and the ownership filter", () => {
    renderDashboard(snapshot([mockWorkspace]));

    expect(screen.getByText("Design System")).toBeInTheDocument();

    const searchInput = screen.getByLabelText("Search workspaces");
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });
    expect(screen.queryByText("Design System")).toBeNull();
    expect(
      screen.getByText("No workspaces match “nonexistent”"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Show all workspaces" }),
    );
    expect(screen.getByText("Design System")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Shared" }));
    expect(screen.queryByText("Design System")).toBeNull();
    expect(screen.getByText("Nothing shared with you yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Owned" }));
    expect(screen.getByText("Design System")).toBeInTheDocument();
  });

  it("opens the create dialog from the header", () => {
    renderDashboard(snapshot([]));

    expect(screen.getByText("Create your first workspace")).toBeInTheDocument();
    const [headerButton] = screen.getAllByRole("button", {
      name: "New workspace",
    });
    fireEvent.click(headerButton!);

    expect(
      screen.getByRole("dialog", { name: "New workspace" }),
    ).toBeInTheDocument();
  });

  it("disables creating once every workspace slot is used", () => {
    renderDashboard(snapshot([mockWorkspace], { workspaceLimit: 1 }));

    expect(
      screen.getByRole("button", { name: "New workspace" }),
    ).toBeDisabled();
    expect(screen.getByText("Limit reached")).toBeInTheDocument();
  });

  it("shows an accepted deletion as in progress until the poll removes it", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/api/gen2/home")
        ? new Response(JSON.stringify(snapshot([])))
        : new Response(JSON.stringify({ success: true }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderDashboard(snapshot([mockWorkspace]));

    fireEvent.click(
      screen.getByRole("button", { name: "Delete Design System" }),
    );
    const hold = screen.getByRole("button", {
      name: "Hold to delete workspace",
    });
    fireEvent.keyDown(hold, { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600);
    });
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/gen2/workspaces/${mockWorkspace.id}`,
      { method: "DELETE" },
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/gen2/home", expect.anything());
    expect(
      await screen.findByText("Create your first workspace"),
    ).toBeInTheDocument();
  });
});

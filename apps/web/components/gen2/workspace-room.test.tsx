import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Gen2WorkspaceDetail } from "@codev/contracts";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("./workbench", () => ({
  Gen2Workbench: () => <div data-testid="gen2-workbench" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: mocks.refresh,
  }),
}));

import { Gen2WorkspaceRoom } from "./workspace-room";

const workspace: Gen2WorkspaceDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Studio",
  status: "pending",
  sandboxId: null,
  lastError: null,
  role: "owner",
  createdAt: "2026-09-20T20:00:00.000Z",
  updatedAt: "2026-09-20T20:00:00.000Z",
  members: [
    {
      userId: "22222222-2222-4222-8222-222222222222",
      login: "ada",
      name: "Ada",
      role: "owner",
    },
  ],
};

describe("Gen2WorkspaceRoom", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.refresh.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ workspace: { ...workspace, status: "ready" } }),
      }),
    );
  });

  it("starts the instance for the owner", async () => {
    render(<Gen2WorkspaceRoom workspace={workspace} />);
    fireEvent.click(screen.getByRole("button", { name: "Start instance" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/gen2/workspaces/${workspace.id}/instance`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("shows host-wake progress while start is in flight", async () => {
    let finishStart:
      | ((value: { ok: boolean; json: () => Promise<unknown> }) => void)
      | undefined;
    const pendingStart = new Promise<{
      ok: boolean;
      json: () => Promise<unknown>;
    }>((resolve) => {
      finishStart = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") return pendingStart;
        return {
          ok: true,
          json: async () => ({ workspace }),
        };
      }),
    );
    render(<Gen2WorkspaceRoom workspace={workspace} />);
    fireEvent.click(screen.getByRole("button", { name: "Start instance" }));
    expect(
      await screen.findByText(/Waking the Firecracker host/),
    ).toBeInTheDocument();
    finishStart?.({
      ok: true,
      json: async () => ({ workspace: { ...workspace, status: "ready" } }),
    });
    await waitFor(() =>
      expect(
        screen.queryByText(/Waking the Firecracker host/),
      ).not.toBeInTheDocument(),
    );
  });

  it("does not let a member start the instance", () => {
    render(
      <Gen2WorkspaceRoom
        workspace={{ ...workspace, role: "member", status: "pending" }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Start instance" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Waiting for the owner to start the instance."),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Codex" })).toBeInTheDocument();
  });

  it("shows a start failure without leaving the page stuck", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("/chats")) {
          return { ok: true, json: async () => ({ chats: [] }) };
        }
        return {
          ok: false,
          json: async () => ({
            error:
              "The Firecracker host could not be reached. Wait a few seconds and try Start instance again.",
          }),
        };
      }),
    );
    render(<Gen2WorkspaceRoom workspace={workspace} />);
    fireEvent.click(screen.getByRole("button", { name: "Start instance" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Firecracker host could not be reached/,
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("stays on the page after stop even if the response omits members", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (String(url).includes("/chats")) {
          return { ok: true, json: async () => ({ chats: [] }) };
        }
        if (init?.method === "DELETE") {
          return {
            ok: true,
            json: async () => ({
              workspace: {
                id: workspace.id,
                name: workspace.name,
                status: "stopped",
                sandboxId: null,
                lastError: null,
                role: "owner",
                createdAt: workspace.createdAt,
                updatedAt: workspace.updatedAt,
              },
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );
    render(
      <Gen2WorkspaceRoom
        workspace={{ ...workspace, status: "ready", sandboxId: "sandbox-1" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(
      await screen.findByRole("button", { name: "Start instance" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Codex" })).toBeInTheDocument();
  });
});

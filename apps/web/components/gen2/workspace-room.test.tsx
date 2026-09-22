import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Gen2WorkspaceDetail } from "@codev/contracts";

vi.mock("./workbench", () => ({
  Gen2Workbench: () => <div data-testid="gen2-workbench" />,
}));

import { Gen2WorkspaceRoom } from "./workspace-room";

const workspace: Gen2WorkspaceDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Studio",
  repository: null,
  status: "pending",
  sandboxId: null,
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
  members: [
    {
      userId: "22222222-2222-4222-8222-222222222222",
      login: "ada",
      name: "Ada",
      role: "owner",
    },
  ],
};

function stubFetch(instance: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      if (path.endsWith("/instance")) return instance();
      if (path.endsWith("/share")) {
        return new Response(
          JSON.stringify({ inviteUrl: "https://codev.test/gen2/join/tok" }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ chats: [] }), { status: 200 });
    }),
  );
}

const ready = () =>
  new Response(
    JSON.stringify({ workspace: { ...workspace, status: "ready" } }),
    { status: 200 },
  );

describe("Gen2WorkspaceRoom", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("brings the machine up on open, with nothing to press", async () => {
    stubFetch(ready);
    render(<Gen2WorkspaceRoom workspace={workspace} />);

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/gen2/workspaces/${workspace.id}/instance`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Stop/ })).toBeNull();
  });

  it("does not ask for a machine that is already running", async () => {
    stubFetch(ready);
    render(<Gen2WorkspaceRoom workspace={{ ...workspace, status: "ready" }} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(
      (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
        (call) => String(call[0]).endsWith("/instance"),
      ),
    ).toHaveLength(0);
  });

  it("offers a retry when the machine could not start", async () => {
    let attempt = 0;
    stubFetch(() => {
      attempt += 1;
      return attempt === 1
        ? new Response(
            JSON.stringify({
              error: "The Firecracker host could not be reached.",
            }),
            { status: 502 },
          )
        : ready();
    });
    render(<Gen2WorkspaceRoom workspace={workspace} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be reached/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Ready")).toBeInTheDocument();
  });

  it("opens the members and access panel", async () => {
    stubFetch(ready);
    render(<Gen2WorkspaceRoom workspace={{ ...workspace, status: "ready" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Members/ }));

    expect(
      await screen.findByRole("heading", { name: "Members & access" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Invite link")).toBeInTheDocument();
  });

  it("shows who else is in the workspace", async () => {
    stubFetch(ready);
    render(<Gen2WorkspaceRoom workspace={{ ...workspace, status: "ready" }} />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(
      await screen.findByRole("region", { name: "Codex" }),
    ).toBeInTheDocument();
  });
});

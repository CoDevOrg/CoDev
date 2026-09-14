import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";

import {
  applyOrcaWorkspaceBranding,
  buildOrcaIframeSource,
  buildOrcaPendingIframeSource,
  createOrcaManagedProposal,
  discardOrcaManagedProposal,
  isActionableOrcaConnectStatus,
  WorkspaceTopBar,
} from "./orca-workspace";

describe("isActionableOrcaConnectStatus", () => {
  it("surfaces runtime configuration errors instead of retrying forever", () => {
    expect(isActionableOrcaConnectStatus(400)).toBe(true);
    expect(isActionableOrcaConnectStatus(503)).toBe(false);
  });
});

describe("discardOrcaManagedProposal", () => {
  it("maps an Orca worktree to its session and invokes audited discard", async () => {
    const worktreeId = "c1f9fe13-6881-44a6-adbd-96bc5a946afa";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ sessions: [{ id: "session-1", worktreeId }] }),
      )
      .mockResolvedValueOnce(Response.json({ status: "discarded" }));

    await expect(
      discardOrcaManagedProposal("workspace-1", worktreeId, fetcher),
    ).resolves.toEqual({ managed: true, ok: true });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/workspaces/workspace-1/agents",
      { cache: "no-store" },
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/workspaces/workspace-1/agents/session-1/discard",
      { method: "POST" },
    );
  });

  it("leaves ordinary Orca worktrees on the native delete path", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        sessions: [
          {
            id: "session-1",
            worktreeId: "c1f9fe13-6881-44a6-adbd-96bc5a946afa",
          },
        ],
      }),
    );

    await expect(
      discardOrcaManagedProposal(
        "workspace-1",
        "d2487707-933c-4f18-8a5d-f5cf31b0ad2e",
        fetcher,
      ),
    ).resolves.toEqual({ managed: false });
  });
});

describe("createOrcaManagedProposal", () => {
  it("creates an isolated managed proposal without sending provider credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json(
        {
          sessionId: "session-1",
          worktreeId: "c1f9fe13-6881-44a6-adbd-96bc5a946afa",
        },
        { status: 201 },
      ),
    );

    await expect(
      createOrcaManagedProposal("workspace-1", fetcher),
    ).resolves.toEqual({
      ok: true,
      worktreeId: "c1f9fe13-6881-44a6-adbd-96bc5a946afa",
    });
    expect(fetcher).toHaveBeenCalledWith("/api/workspaces/workspace-1/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Managed proposal",
        draft: true,
        attachments: [],
      }),
    });
  });

  it("returns the server-side fourth-session rejection", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json(
        {
          error:
            "All three agent slots are in use. Stop or wait for an active session to finish before starting another.",
          code: "agent_capacity_exceeded",
        },
        { status: 409 },
      ),
    );

    await expect(
      createOrcaManagedProposal("workspace-1", fetcher),
    ).resolves.toEqual({
      ok: false,
      status: 409,
      code: "agent_capacity_exceeded",
      error:
        "All three agent slots are in use. Stop or wait for an active session to finish before starting another.",
    });
  });

  it("rejects a create response that omits the managed worktree id", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ sessionId: "session-1" }, { status: 201 }),
      );

    await expect(
      createOrcaManagedProposal("workspace-1", fetcher),
    ).resolves.toEqual({
      ok: false,
      error: "CoDev did not return a managed proposal worktree.",
    });
  });
});

describe("WorkspaceTopBar", () => {
  it("shows the reconciled three-agent worktree capacity", () => {
    render(
      createElement(WorkspaceTopBar, {
        repository: "yousef20920/CoDev",
        workspaceId: "workspace-1",
        canInvite: true,
      }),
    );

    expect(
      screen.getByLabelText("Agent worktree capacity: 3 slots"),
    ).toHaveTextContent("3 agent worktree slots");
  });

  it("shows how many agents are working without opening a panel", () => {
    render(
      createElement(WorkspaceTopBar, {
        repository: "yousef20920/CoDev",
        workspaceId: "workspace-1",
        canInvite: true,
        agents: { active: 2, idle: 0 },
      }),
    );

    expect(screen.getByLabelText("2 agents working")).toHaveTextContent(
      "2 agents working",
    );
  });

  /**
   * Mission Control lists an open chat tab that has never run anything, so a
   * bar that called every row "live" claimed "1 agent live" beside that same
   * panel's "Idle". Idle sessions are reported as what they are.
   */
  it("does not call an idle chat tab a live agent", () => {
    render(
      createElement(WorkspaceTopBar, {
        repository: "yousef20920/CoDev",
        workspaceId: "workspace-1",
        canInvite: true,
        agents: { active: 0, idle: 1 },
        slotsUsed: 0,
        slotsTotal: 3,
      }),
    );

    expect(
      screen.getByLabelText("1 agent idle; worktree slots: 0 of 3 in use"),
    ).toHaveTextContent("1 agent idle · 0 of 3 slots");
    expect(screen.queryByText(/live/i)).not.toBeInTheDocument();
  });

  it("says so when the workspace is up with nothing running", () => {
    render(
      createElement(WorkspaceTopBar, {
        repository: "yousef20920/CoDev",
        workspaceId: "workspace-1",
        canInvite: true,
        agents: { active: 0, idle: 0 },
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("No agents running");
  });

  /**
   * Two chat tabs in one checkout are two agents and one slot; a chat in the
   * workspace's own checkout is an agent and no slot. The bar used to print
   * the agent count over the slot denominator, so four tabs read "4 of 3".
   */
  it("keeps agents and worktree slots as separate numbers", () => {
    render(
      createElement(WorkspaceTopBar, {
        repository: "yousef20920/CoDev",
        workspaceId: "workspace-1",
        canInvite: true,
        agents: { active: 4, idle: 0 },
        slotsUsed: 1,
        slotsTotal: 3,
      }),
    );

    expect(
      screen.getByLabelText("4 agents working; worktree slots: 1 of 3 in use"),
    ).toHaveTextContent("4 agents working · 1 of 3 slots");
    expect(screen.queryByText(/4 of 3/)).not.toBeInTheDocument();
  });

  it("does not present a provisional zero while the workspace is starting", () => {
    render(
      createElement(WorkspaceTopBar, {
        repository: "yousef20920/CoDev",
        workspaceId: "workspace-1",
        canInvite: true,
        agents: { active: 0, idle: 0 },
        isStarting: true,
      }),
    );

    expect(
      screen.getByRole("status", { name: "Workspace is starting" }),
    ).toHaveTextContent("Starting workspace…");
    expect(screen.queryByText("0 of 3 agents live")).not.toBeInTheDocument();
  });
});

describe("buildOrcaIframeSource", () => {
  it("keeps the pairing credential and validated project bootstrap in the URL fragment", () => {
    const source = buildOrcaIframeSource({
      webClientPath: "/orca/web-index.html",
      pairingCode: "secret pairing offer",
      workspacePath:
        "/srv/codev/workspaces/c1f9fe13-6881-44a6-adbd-96bc5a946afa",
      projectKind: "git",
      projectName: "yousef20920/CoDev",
    });
    const url = new URL(source, "https://codev.example");

    expect(url.pathname).toBe("/orca/web-index.html");
    expect(url.search).toBe("");
    const fragment = new URLSearchParams(url.hash.slice(1));
    expect(fragment.get("pairing")).toBe("secret pairing offer");
    expect(fragment.get("codev")).toBe("1");
    expect(fragment.get("codevProject")).toBe(
      "/srv/codev/workspaces/c1f9fe13-6881-44a6-adbd-96bc5a946afa",
    );
    expect(fragment.get("codevProjectKind")).toBe("git");
    expect(fragment.get("codevProjectName")).toBe("yousef20920/CoDev");
    expect(fragment.get("codevDefaultAgent")).toBeNull();
  });

  it("pins the default chat agent when one is provided", () => {
    const source = buildOrcaIframeSource({
      webClientPath: "/orca/web-index.html",
      pairingCode: "secret pairing offer",
      workspacePath:
        "/srv/codev/workspaces/c1f9fe13-6881-44a6-adbd-96bc5a946afa",
      projectKind: "git",
      defaultAgent: "codex",
    });
    const fragment = new URLSearchParams(
      new URL(source, "https://codev.example").hash.slice(1),
    );

    expect(fragment.get("codevDefaultAgent")).toBe("codex");
  });
});

describe("buildOrcaPendingIframeSource", () => {
  it("carries only origin-known facts and no runtime credential", () => {
    const source = buildOrcaPendingIframeSource({
      projectKind: "git",
      projectName: "yousef20920/CoDev",
      defaultAgent: "codex",
      cursorAvailable: true,
    });
    const url = new URL(source, "https://codev.example");
    const fragment = new URLSearchParams(url.hash.slice(1));

    expect(url.pathname).toBe("/orca/web-index.html");
    expect(fragment.get("codev")).toBe("1");
    expect(fragment.get("codevPending")).toBe("1");
    expect(fragment.get("codevProjectKind")).toBe("git");
    expect(fragment.get("codevProjectName")).toBe("yousef20920/CoDev");
    expect(fragment.get("codevDefaultAgent")).toBe("codex");
    expect(fragment.get("codevCursorAvailable")).toBe("1");
    // The pairing offer and on-instance path only exist once the host is up.
    expect(fragment.get("pairing")).toBeNull();
    expect(fragment.get("codevProject")).toBeNull();
    expect(fragment.get("codevMemberId")).toBeNull();
  });

  it("omits optional facts when not supplied", () => {
    const fragment = new URLSearchParams(
      new URL(
        buildOrcaPendingIframeSource({ projectKind: "folder" }),
        "https://codev.example",
      ).hash.slice(1),
    );
    expect(fragment.get("codevProjectKind")).toBe("folder");
    expect(fragment.get("codevProjectName")).toBeNull();
    expect(fragment.get("codevDefaultAgent")).toBeNull();
    expect(fragment.get("codevCursorAvailable")).toBeNull();
  });
});

describe("applyOrcaWorkspaceBranding", () => {
  it("replaces the empty-state mark and labels the IDE with its workspace", () => {
    const doc = document.implementation.createHTMLDocument("Orca");
    doc.body.innerHTML = `
      <img alt="CoDev logo" src="/orca/assets/orca-logo.png" />
      <span class="titlebar-app-name-main">CoDev</span>
    `;

    applyOrcaWorkspaceBranding(doc, "yousef20920/CoDev");

    expect(doc.querySelector("img")?.getAttribute("src")).toBe(
      "/brand/codev-mark-v3.png",
    );
    expect(doc.querySelector("img")?.className).toContain(
      "codev-orca-empty-logo",
    );
    expect(
      doc
        .querySelector(".titlebar-app-name-main")
        ?.getAttribute("data-codev-workspace-name"),
    ).toBe("yousef20920/CoDev");
  });
});

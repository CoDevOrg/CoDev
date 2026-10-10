import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceBranchMenu } from "./workspace-branch-menu";

const worktrees = [
  { worktreeId: "main", branch: "main" },
  { worktreeId: "feature-auth", branch: "feature/auth" },
];

function respond(branches: string[], extra: object = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            branches: branches.map((name) => ({ name })),
            defaultBranch: "main",
            truncated: false,
            unavailable: null,
            ...extra,
          }),
        ),
    ),
  );
}

function renderMenu(props: Partial<Parameters<typeof WorkspaceBranchMenu>[0]>) {
  render(
    <WorkspaceBranchMenu
      workspaceId="ws-1"
      branches={worktrees}
      selected={worktrees[0]}
      getStatus={() => ({ label: "Clean", tone: "clean" })}
      loadError={false}
      onRetry={vi.fn()}
      onSelect={vi.fn()}
      {...props}
    />,
  );
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Active branch: main" }),
    { button: 0, ctrlKey: false },
  );
}

describe("WorkspaceBranchMenu", () => {
  beforeEach(() => respond(["main", "feature/auth", "develop", "release/1.2"]));
  afterEach(() => vi.unstubAllGlobals());

  it("lists the repository's remote branches beside the open ones", async () => {
    const onOpenRemote = vi.fn();
    renderMenu({ onOpenRemote });

    expect(await screen.findByText("develop")).toBeInTheDocument();
    expect(screen.getByText("release/1.2")).toBeInTheDocument();
    // Branches already open appear once, under "Open in workspace".
    expect(screen.getAllByText("feature/auth")).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/gen2/workspaces/ws-1/branches",
      expect.objectContaining({ cache: "no-store" }),
    );

    fireEvent.click(screen.getByRole("menuitem", { name: /develop/ }));
    expect(onOpenRemote).toHaveBeenCalledWith("develop");
  });

  it("lists private repository branches without offering to open them", async () => {
    const onOpenRemote = vi.fn();
    renderMenu({ onOpenRemote, repositoryPrivate: true });

    const develop = await screen.findByRole("menuitem", { name: /develop/ });
    expect(develop).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/can’t be opened here yet/)).toBeInTheDocument();
  });

  it("explains when GitHub is not connected", async () => {
    respond([], { unavailable: "github-not-connected" });
    renderMenu({});

    expect(
      await screen.findByText(/Connect GitHub in Settings/),
    ).toBeInTheDocument();
  });

  it("filters long branch lists by name", async () => {
    respond(Array.from({ length: 12 }, (_, index) => `topic-${index}`));
    renderMenu({ onOpenRemote: vi.fn() });

    await screen.findByText("topic-11");
    fireEvent.change(screen.getByLabelText("Find a branch"), {
      target: { value: "topic-1" },
    });
    expect(screen.queryByText("topic-2")).not.toBeInTheDocument();
    expect(screen.getByText("topic-10")).toBeInTheDocument();
  });
});

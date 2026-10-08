import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./review-diff-viewer", () => ({
  ReviewDiffViewer: ({ patch }: { patch: string }) => (
    <pre data-testid="review-diff">{patch}</pre>
  ),
}));

import { SupersetChangesPane } from "./superset-changes-pane";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";

function gitResponse(output: string, ok = true) {
  return Promise.resolve(
    new Response(JSON.stringify({ output, error: ok ? undefined : output }), {
      status: ok ? 200 : 502,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("SupersetChangesPane", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("marks a changed file another active agent is also changing", async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) =>
      gitResponse(
        String(input).includes("operation=status")
          ? "## main\n M src/login.ts\n?? notes.md\n"
          : "",
      ),
    );

    render(
      <SupersetChangesPane
        workspaceId={workspaceId}
        worktreeId="main"
        visible
        mode="changes"
        overlapFor={(path) =>
          path === "src/login.ts"
            ? "Also changed by fix-auth (claude, Sara)"
            : undefined
        }
      />,
    );

    expect(
      await screen.findByText("Also changed by fix-auth (claude, Sara)"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Also changed by/)).toHaveLength(1);
  });

  it("does not report a clean tree before git status loads", () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    render(
      <SupersetChangesPane
        workspaceId={workspaceId}
        worktreeId="main"
        visible
        mode="changes"
      />,
    );
    expect(screen.getByText("Reading git status…")).toBeInTheDocument();
    expect(screen.queryByText("Working tree is clean")).not.toBeInTheDocument();
  });

  it("lists changed files and opens them without claiming the tree is clean", async () => {
    const onOpenFile = vi.fn();
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("operation=status")) {
        return gitResponse("## main\n M src/login.ts\n?? notes.md\n");
      }
      return gitResponse("diff --git a/src/login.ts b/src/login.ts\n");
    });

    render(
      <SupersetChangesPane
        workspaceId={workspaceId}
        worktreeId="main"
        visible
        mode="changes"
        onOpenFile={onOpenFile}
      />,
    );

    expect(await screen.findByText("src/login.ts")).toBeInTheDocument();
    expect(screen.getByText("2 changed files")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /src\/login\.ts/ }));
    expect(onOpenFile).toHaveBeenCalledWith("src/login.ts");
  });

  it("keeps review unavailable distinct from an empty diff", async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("operation=status")) {
        return gitResponse("## main\n M src/login.ts\n");
      }
      return gitResponse("Couldn’t load the working tree diff.", false);
    });

    render(
      <SupersetChangesPane
        workspaceId={workspaceId}
        worktreeId="main"
        visible
        mode="review"
      />,
    );

    expect(
      await screen.findByText("Couldn’t load the working tree diff."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("This branch has nothing to review yet."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Working tree is clean")).not.toBeInTheDocument();
  });

  it("explains untracked files instead of showing an empty patch", async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("operation=status")) {
        return gitResponse("## main\n?? notes.md\n");
      }
      return gitResponse("");
    });

    render(
      <SupersetChangesPane
        workspaceId={workspaceId}
        worktreeId="main"
        visible
        mode="review"
      />,
    );

    expect(
      await screen.findByText("New files have no diff until Git tracks them."),
    ).toBeInTheDocument();
  });
});

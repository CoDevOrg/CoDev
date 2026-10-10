import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("./superset-file-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createSupersetWorktree: (...args: unknown[]) => mocks.create(...args),
}));

import { WorkspaceWorktreeForm } from "./workspace-worktree-form";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const worktrees = [
  { worktreeId: "main", branch: "HEAD" },
  { worktreeId: "yousefs", branch: "main" },
];

function renderForm(overrides = {}) {
  const props = {
    workspaceId,
    worktrees,
    currentWorktreeId: "yousefs",
    repositoryPrivate: false,
    onCreated: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<WorkspaceWorktreeForm {...props} />);
  return props;
}

describe("WorkspaceWorktreeForm", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          branches: [{ name: "main" }, { name: "feature/remote" }],
          defaultBranch: "main",
          truncated: false,
          unavailable: null,
        }),
      ),
    );
    mocks.create.mockImplementation(
      async (_id: string, input: { worktreeId: string; branch: string }) => ({
        worktreeId: input.worktreeId,
        branch: input.branch,
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("lists GitHub branches that are not already open", async () => {
    renderForm();
    const branch = screen.getByLabelText("Branch");
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "feature/remote" }),
      ).toBeInTheDocument(),
    );
    // main is open in the yousefs worktree, so it is not offered again.
    expect(
      Array.from(branch.querySelectorAll("option")).map((o) => o.textContent),
    ).toEqual(["New branch…", "feature/remote"]);
  });

  it("explains instead of failing when a new branch is already open", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("New branch name"), {
      target: { value: "main" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "main is already open in main (yousefs)",
    );
    expect(
      screen.getByRole("button", { name: "Create worktree" }),
    ).toBeDisabled();
  });

  it("creates a new branch from the current worktree's branch", async () => {
    const props = renderForm();
    fireEvent.change(screen.getByLabelText("New branch name"), {
      target: { value: "fix/login" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create worktree" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(workspaceId, {
        worktreeId: "fix-login",
        branch: "fix/login",
        baseRef: "main",
      }),
    );
    expect(props.onCreated).toHaveBeenCalledWith({
      worktreeId: "fix-login",
      branch: "fix/login",
    });
  });

  it("opens a GitHub branch in a folder the member names", async () => {
    renderForm();
    await screen.findByRole("option", { name: "feature/remote" });
    fireEvent.change(screen.getByLabelText("Branch"), {
      target: { value: "feature/remote" },
    });
    expect(screen.queryByLabelText("New branch name")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Folder name/), {
      target: { value: "Remote work" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create worktree" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(workspaceId, {
        worktreeId: "remote-work",
        branch: "feature/remote",
        baseRef: "origin/feature/remote",
      }),
    );
  });

  it("offers no GitHub branches for a private repository", async () => {
    renderForm({ repositoryPrivate: true });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(
      screen.queryByRole("option", { name: "feature/remote" }),
    ).not.toBeInTheDocument();
  });
});

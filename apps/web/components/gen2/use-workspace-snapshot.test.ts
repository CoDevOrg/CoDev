import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  GEN2_WORKSPACE_CONTEXT_LIMITS,
  gen2WorkspaceContextSchema,
} from "@codev/contracts";

import {
  useWorkspaceSnapshot,
  type WorkspaceSnapshotInput,
} from "./use-workspace-snapshot";

const many = <T>(count: number, make: (index: number) => T) =>
  Array.from({ length: count }, (_, index) => make(index));

function input(
  overrides: Partial<WorkspaceSnapshotInput> = {},
): WorkspaceSnapshotInput {
  return {
    viewMode: "ide",
    inspector: "files",
    terminalOpen: true,
    worktreeId: "main",
    worktrees: [
      { worktreeId: "main", branch: "main" },
      { worktreeId: "feat-a", branch: "feat/a" },
    ],
    fileCounts: { main: 3 },
    dirty: true,
    openFilePath: "src/app.ts",
    preview: { port: 3000, path: "/login" },
    listeningPorts: [3000, 5173],
    members: [
      {
        userId: "u1",
        login: "ada",
        name: "Ada",
        email: "ada@example.com",
        role: "owner",
      },
    ],
    runs: [
      {
        id: "r1",
        chatId: "c1",
        provider: "claude",
        status: "running",
        worktreeId: "feat-a",
        branch: "feat/a",
      },
    ],
    chats: [
      {
        id: "c1",
        title: "Fix login",
        createdAt: "2026-10-09T00:00:00.000Z",
        updatedAt: "2026-10-09T00:00:00.000Z",
      },
    ],
    previewEnabled: true,
    ...overrides,
  };
}

function snapshot(
  value: WorkspaceSnapshotInput,
  selection: { path: string; startLine: number; endLine: number } | null = null,
) {
  const { result } = renderHook(() =>
    useWorkspaceSnapshot(value, {
      selection: () => selection,
      narrow: () => false,
    }),
  );
  return result.current();
}

describe("useWorkspaceSnapshot", () => {
  it("describes what the member sees, without emails", () => {
    const view = snapshot(input(), {
      path: "src/app.ts",
      startLine: 4,
      endLine: 9,
    });
    expect(view).toEqual({
      view: {
        mode: "ide",
        inspector: "files",
        terminalOpen: true,
        narrow: false,
      },
      worktree: {
        id: "main",
        branch: "main",
        changedFiles: 3,
        unsavedEdits: true,
      },
      worktrees: [
        { id: "main", branch: "main" },
        { id: "feat-a", branch: "feat/a" },
      ],
      openFile: { path: "src/app.ts", selection: { startLine: 4, endLine: 9 } },
      preview: { port: 3000, path: "/login" },
      listeningPorts: [3000, 5173],
      members: [{ login: "ada", role: "owner" }],
      agents: [
        {
          provider: "claude",
          status: "running",
          branch: "feat/a",
          chatTitle: "Fix login",
        },
      ],
      excerpts: [],
      previewEnabled: true,
    });
    expect(JSON.stringify(view)).not.toContain("ada@example.com");
  });

  it("clamps a large workspace to the contract so a turn never fails", () => {
    const limits = GEN2_WORKSPACE_CONTEXT_LIMITS;
    const view = snapshot(
      input({
        worktrees: [
          ...many(30, (index) => ({
            worktreeId: `wt-${index}`,
            branch: `b${"x".repeat(300)}`,
          })),
          { worktreeId: "Not Valid", branch: "odd" },
        ],
        members: many(30, (index) => ({
          userId: `u${index}`,
          login: "l".repeat(100),
          name: null,
          email: null,
          role: "editor" as const,
        })),
        runs: many(15, (index) => ({
          id: `r${index}`,
          chatId: null,
          provider: null,
          status: index === 14 ? "running" : "completed",
          worktreeId: "main",
          branch: null,
        })),
        listeningPorts: [0, 70_000, ...many(12, (index) => 3000 + index)],
        openFilePath: `${"d/".repeat(600)}f.ts`,
      }),
    );
    expect(view).not.toBeNull();
    expect(gen2WorkspaceContextSchema.safeParse(view).success).toBe(true);
    expect(view!.worktrees).toHaveLength(limits.worktrees);
    expect(view!.worktrees[0]!.branch).toHaveLength(255);
    expect(view!.members).toHaveLength(limits.members);
    expect(view!.agents).toHaveLength(limits.agents);
    expect(view!.agents[0]!.status).toBe("running");
    expect(view!.listeningPorts).toHaveLength(limits.listeningPorts);
    expect(view!.listeningPorts).not.toContain(0);
    expect(view!.openFile!.path).toHaveLength(1024);
  });

  it("reports a selection only for the open file, and unknowns as unknown", () => {
    const view = snapshot(
      input({
        fileCounts: {},
        listeningPorts: null,
        preview: { port: null, path: "/" },
      }),
      { path: "src/other.ts", startLine: 1, endLine: 2 },
    );
    expect(view?.openFile?.selection).toBeNull();
    expect(view?.worktree.changedFiles).toBeNull();
    expect(view?.listeningPorts).toBeNull();
    expect(view?.preview).toBeNull();
  });

  it("reads the latest state through a stable function", () => {
    const { result, rerender } = renderHook(
      (value: WorkspaceSnapshotInput) =>
        useWorkspaceSnapshot(value, {
          selection: () => null,
          narrow: () => true,
        }),
      { initialProps: input() },
    );
    const first = result.current;
    rerender(input({ viewMode: "board", inspector: null }));
    expect(result.current).toBe(first);
    expect(first()?.view).toEqual({
      mode: "board",
      inspector: null,
      terminalOpen: true,
      narrow: true,
    });
  });
});

"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import {
  GEN2_WORKSPACE_CONTEXT_LIMITS as LIMITS,
  gen2SupersetWorktreeIdSchema,
  gen2WorkspaceContextSchema,
  type Gen2Chat,
  type Gen2SupersetWorktree,
  type Gen2WorkspaceContext,
  type Gen2WorkspaceMember,
} from "@codev/contracts";

import type { WorkspaceInspectorTab } from "./workspace-action-run";
import type { WorkspaceAgentRun } from "./workspace-controller";

export type WorkspaceSnapshotInput = {
  viewMode: "ide" | "board";
  inspector: WorkspaceInspectorTab | null;
  terminalOpen: boolean;
  worktreeId: string;
  worktrees: Gen2SupersetWorktree[];
  fileCounts: Record<string, number>;
  dirty: boolean;
  openFilePath: string | null;
  preview: { port: number | null; path: string };
  listeningPorts: number[] | null;
  members: Gen2WorkspaceMember[];
  runs: WorkspaceAgentRun[];
  chats: Gen2Chat[];
  previewEnabled: boolean;
};

type Selection = { path: string; startLine: number; endLine: number } | null;

const ACTIVE = new Set(["running", "creating"]);
const isPort = (port: number) =>
  Number.isInteger(port) && port >= 1 && port <= 65_535;
const isLine = (line: number) =>
  Number.isInteger(line) && line >= 1 && line <= 10_000_000;

function agentsFor(input: WorkspaceSnapshotInput) {
  const branchOf = (id: string) =>
    input.worktrees.find((worktree) => worktree.worktreeId === id)?.branch;
  return [...input.runs]
    .sort((a, b) => Number(ACTIVE.has(b.status)) - Number(ACTIVE.has(a.status)))
    .slice(0, LIMITS.agents)
    .map((run) => ({
      provider: (run.provider ?? "agent").slice(0, 20),
      status: run.status.slice(0, 30),
      branch: branchOf(run.worktreeId)?.slice(0, 255) ?? null,
      chatTitle:
        input.chats
          .find((chat) => chat.id === run.chatId)
          ?.title.slice(0, 80) ?? null,
    }));
}

/** Everything but the parts read at send time, clamped to the contract. */
function baseSnapshot(input: WorkspaceSnapshotInput) {
  const branch =
    input.worktrees.find((worktree) => worktree.worktreeId === input.worktreeId)
      ?.branch ?? input.worktreeId;
  const { port, path } = input.preview;
  return {
    view: {
      mode: input.viewMode,
      inspector: input.inspector,
      terminalOpen: input.terminalOpen,
    },
    worktree: {
      id: input.worktreeId,
      branch: branch.slice(0, 255),
      changedFiles: input.fileCounts[input.worktreeId] ?? null,
      unsavedEdits: input.dirty,
    },
    worktrees: input.worktrees
      .filter(
        (worktree) =>
          gen2SupersetWorktreeIdSchema.safeParse(worktree.worktreeId).success,
      )
      .slice(0, LIMITS.worktrees)
      .map((worktree) => ({
        id: worktree.worktreeId,
        branch: worktree.branch.slice(0, 255),
      })),
    openFilePath: input.openFilePath?.slice(0, 1024) ?? null,
    preview:
      port !== null && isPort(port) ? { port, path: path.slice(0, 512) } : null,
    listeningPorts:
      input.listeningPorts?.filter(isPort).slice(0, LIMITS.listeningPorts) ??
      null,
    members: input.members.slice(0, LIMITS.members).map((member) => ({
      login: member.login.slice(0, 80),
      role: member.role,
    })),
    agents: agentsFor(input),
    previewEnabled: input.previewEnabled,
  };
}

function finish(
  base: ReturnType<typeof baseSnapshot>,
  selection: Selection,
  narrow: boolean,
): Gen2WorkspaceContext | null {
  const { openFilePath, ...rest } = base;
  const range =
    selection &&
    selection.path === openFilePath &&
    isLine(selection.startLine) &&
    isLine(selection.endLine)
      ? { startLine: selection.startLine, endLine: selection.endLine }
      : null;
  const parsed = gen2WorkspaceContextSchema.safeParse({
    ...rest,
    view: { ...rest.view, narrow },
    openFile: openFilePath ? { path: openFilePath, selection: range } : null,
    excerpts: [],
  });
  return parsed.success ? parsed.data : null;
}

/**
 * What the member currently sees, sent with each turn. Clamped to the
 * contract's bounds so a large workspace never makes a turn fail; excerpts
 * are added by the composer only for what the member explicitly mentions.
 * `getSnapshot` is stable, reads the latest state, and builds the snapshot
 * only when asked (at send time), not on every render.
 */
export function useWorkspaceSnapshot(
  input: WorkspaceSnapshotInput,
  live: { selection(): Selection; narrow(): boolean },
) {
  const latest = useRef({ input, live });
  useLayoutEffect(() => {
    latest.current = { input, live };
  });
  return useCallback(() => {
    const { input: current, live: now } = latest.current;
    return finish(baseSnapshot(current), now.selection(), now.narrow());
  }, []);
}

"use client";

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type {
  Gen2AgentProviderName,
  Gen2Chat,
  Gen2SupersetEntry,
  Gen2SupersetWorktree,
} from "@codev/contracts";

import { listSupersetFiles } from "./superset-file-client";
import type {
  WorkspaceAgentRun,
  WorkspaceAgentSources,
} from "./workspace-controller";

/** An agent run as the runs API returns it (its provider is the vendor). */
export type WorkspaceShellRun = {
  id: string;
  chatId?: string | null | undefined;
  provider: string;
  status: string;
  worktreeId: string;
};

/** Above this the file API refuses, and a mention menu would not help. */
const MAX_FILES = 5_000;

const RUN_PROVIDERS: Record<string, Gen2AgentProviderName> = {
  openai: "codex",
  anthropic: "claude",
  cursor: "cursor",
  codex: "codex",
  claude: "claude",
};

function agentRuns(
  runs: WorkspaceShellRun[],
  worktrees: Gen2SupersetWorktree[],
): WorkspaceAgentRun[] {
  return runs.map((run) => ({
    id: run.id,
    chatId: run.chatId ?? null,
    provider: RUN_PROVIDERS[run.provider] ?? null,
    status: run.status,
    worktreeId: run.worktreeId,
    branch:
      worktrees.find((worktree) => worktree.worktreeId === run.worktreeId)
        ?.branch ?? null,
  }));
}

type Input = {
  workspaceId: string;
  connected: boolean;
  chats: Gen2Chat[];
  activeChatId: string | null;
  worktreeId: string;
  worktrees: Gen2SupersetWorktree[];
  runs: WorkspaceShellRun[];
  refreshRuns(): void;
  selection: WorkspaceAgentSources["selection"];
  terminalTail: WorkspaceAgentSources["terminalTail"];
};

/** The current worktree's files, listed once per worktree and only while connected. */
function useFileList(latest: { current: Input }) {
  const files = useRef(new Map<string, Promise<Gen2SupersetEntry[] | null>>());
  const listFiles = useCallback(() => {
    const { workspaceId, worktreeId, connected } = latest.current;
    if (!connected) return Promise.resolve(null);
    const cached = files.current.get(worktreeId);
    if (cached) return cached;
    const request = listSupersetFiles(workspaceId, worktreeId).then(
      (entries) => (entries.length > MAX_FILES ? null : entries),
      () => {
        files.current.delete(worktreeId);
        return null;
      },
    );
    files.current.set(worktreeId, request);
    return request;
  }, [latest]);
  const invalidateFiles = useCallback(() => {
    files.current.delete(latest.current.worktreeId);
  }, [latest]);
  return { listFiles, invalidateFiles };
}

/**
 * What the composer can mention: chats, agent runs, the current worktree's
 * files, the editor selection and the visible terminal's last lines. The
 * functions are stable and read the latest state.
 */
export function useWorkspaceAgentSources(input: Input): WorkspaceAgentSources {
  const latest = useRef(input);
  useLayoutEffect(() => {
    latest.current = input;
  });
  const { listFiles, invalidateFiles } = useFileList(latest);
  const live = useMemo(
    () => ({
      refreshRuns: () => latest.current.refreshRuns(),
      selection: () => latest.current.selection(),
      terminalTail: () => latest.current.terminalTail(),
    }),
    [],
  );
  const { chats, activeChatId, worktreeId, runs, worktrees } = input;
  const runsForChat = useMemo(
    () => agentRuns(runs, worktrees),
    [runs, worktrees],
  );
  return useMemo(
    () => ({
      chats,
      activeChatId,
      worktreeId,
      agentRuns: runsForChat,
      listFiles,
      invalidateFiles,
      ...live,
    }),
    [
      chats,
      activeChatId,
      worktreeId,
      runsForChat,
      listFiles,
      invalidateFiles,
      live,
    ],
  );
}

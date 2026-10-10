"use client";

import { createContext, useContext } from "react";
import type {
  Gen2AgentProviderName,
  Gen2Chat,
  Gen2SupersetEntry,
  Gen2WorkspaceAction,
  Gen2WorkspaceContext,
} from "@codev/contracts";

/**
 * The workspace as the chat sees it: what the member is looking at, and the
 * actions an agent (or a slash command) can take on their behalf. The shell
 * provides it; the composer, the activity rows and the decision cards read
 * it. Outside the shell (tests, a bare chat panel) it is null and those
 * features stay off.
 */

export type WorkspaceActionResult = {
  ok: boolean;
  message: string;
  details?: Array<{ person: string; ok: boolean; message: string }> | undefined;
};

export interface WorkspaceController {
  /** Why this action must wait for a click right now; null when it may run. */
  autoRunBlocker(action: Gen2WorkspaceAction): string | null;
  run(action: Gen2WorkspaceAction): Promise<WorkspaceActionResult>;
  newChat(provider?: Gen2AgentProviderName): Promise<void>;
  openSettings(): void;
  openImport(): void;
  setViewMode(mode: "ide" | "board"): void;
}

export type WorkspaceAgentRun = {
  id: string;
  chatId: string | null;
  provider: Gen2AgentProviderName | null;
  status: string;
  worktreeId: string;
  branch: string | null;
};

export type WorkspaceAgentSources = {
  chats: Gen2Chat[];
  activeChatId: string | null;
  worktreeId: string;
  agentRuns: WorkspaceAgentRun[];
  refreshRuns(): void;
  /** The current worktree's files, cached; null when unavailable. */
  listFiles(): Promise<Gen2SupersetEntry[] | null>;
  invalidateFiles(): void;
  selection(): {
    path: string;
    startLine: number;
    endLine: number;
    text: string;
  } | null;
  /** The visible terminal's last lines, ANSI-stripped; null when closed. */
  terminalTail(): { worktreeId: string; text: string } | null;
};

export type WorkspaceAgentContextValue = {
  controller: WorkspaceController;
  /** The clamped snapshot sent with each turn. */
  getSnapshot(): Gen2WorkspaceContext | null;
  canEdit: boolean;
  previewEnabled: boolean;
  sources: WorkspaceAgentSources;
  /** Text for the next composer to prefill (never auto-sent). */
  draftRequest: { id: string; text: string } | null;
  consumeDraftRequest(id: string): void;
};

export const WorkspaceAgentContext =
  createContext<WorkspaceAgentContextValue | null>(null);

export function useWorkspaceAgent() {
  return useContext(WorkspaceAgentContext);
}

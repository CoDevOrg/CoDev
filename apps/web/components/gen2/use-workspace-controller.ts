"use client";

import {
  useLayoutEffect,
  useMemo,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type {
  Gen2AgentProviderName,
  Gen2Chat,
  Gen2SupersetWorktree,
  Gen2WorkspaceMember,
} from "@codev/contracts";

import {
  useWorkspaceAgentSources,
  type WorkspaceShellRun,
} from "./use-workspace-agent-sources";
import { useWorkspaceRequests } from "./use-workspace-requests";
import { useWorkspaceSnapshot } from "./use-workspace-snapshot";
import { workspaceActionBlocker } from "./workspace-action-blocker";
import { renameWorkspaceChat } from "./workspace-action-rename";
import {
  runWorkspaceAction,
  type WorkspaceActionOps,
  type WorkspaceActionView,
  type WorkspaceInspectorTab,
} from "./workspace-action-run";
import type {
  WorkspaceAgentContextValue,
  WorkspaceController,
} from "./workspace-controller";

/** The shell state and setters the workspace controller drives. */
export type WorkspaceShellBindings = {
  workspaceId: string;
  canEdit: boolean;
  previewEnabled: boolean;
  connected: boolean;
  viewMode: "ide" | "board";
  setViewMode(mode: "ide" | "board"): void;
  tab: WorkspaceInspectorTab;
  setTab(tab: WorkspaceInspectorTab): void;
  inspectorCollapsed: boolean;
  /** The raw setter: a reveal must not pin the inspector open. */
  setInspectorCollapsed(collapsed: boolean): void;
  isNarrow(): boolean;
  terminalExpanded: boolean;
  setTerminalExpanded(expanded: boolean): void;
  worktreeId: string;
  worktrees: Gen2SupersetWorktree[];
  addWorktree(worktree: Gen2SupersetWorktree): void;
  /** The shell's switch, guarded by the unsaved-changes dialog. */
  selectWorktree(worktreeId: string): boolean;
  fileCounts: Record<string, number>;
  dirty: boolean;
  chats: Gen2Chat[];
  setChats: Dispatch<SetStateAction<Gen2Chat[]>>;
  activeChat: Gen2Chat | null;
  activeProvider: Gen2AgentProviderName;
  connectedProviders: Gen2AgentProviderName[];
  createChat(provider: Gen2AgentProviderName): Promise<Gen2Chat | null>;
  handleNewChat(): void;
  members: Gen2WorkspaceMember[];
  /** Agent runs as the runs API returns them (provider is the vendor). */
  runs: WorkspaceShellRun[];
  refreshRuns(): void;
  setShareOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setImportOpen(open: boolean): void;
};

type Requests = ReturnType<typeof useWorkspaceRequests>;
type Latest = RefObject<{
  bindings: WorkspaceShellBindings;
  requests: Requests;
}>;

function actionView({
  bindings: b,
  requests,
}: Latest["current"]): WorkspaceActionView {
  return {
    canEdit: b.canEdit,
    previewEnabled: b.previewEnabled,
    viewMode: b.viewMode,
    narrow: b.isNarrow(),
    worktreeId: b.worktreeId,
    worktrees: b.worktrees,
    dirty: b.dirty,
    openFilePath: requests.inspector.openFilePath,
    listeningPorts: requests.inspector.preview.listeningPorts,
    activeChat: b.activeChat && {
      id: b.activeChat.id,
      title: b.activeChat.title,
    },
    activeProvider: b.activeProvider,
    connectedProviders: b.connectedProviders,
  };
}

async function renameActiveChat(
  workspaceId: string,
  shell: WorkspaceShellBindings,
  title: string,
) {
  const { activeChat, setChats } = shell;
  if (!activeChat) return "Open a chat to rename it.";
  const result = await renameWorkspaceChat(workspaceId, activeChat.id, title);
  if (!("chat" in result)) return result.error;
  const { id, title: saved } = result.chat;
  setChats((chats) =>
    chats.map((chat) => (chat.id === id ? { ...chat, title: saved } : chat)),
  );
  return null;
}

function useActionOps(workspaceId: string, latest: Latest) {
  return useMemo<WorkspaceActionOps>(() => {
    const shell = () => latest.current.bindings;
    const asks = () => latest.current.requests;
    return {
      workspaceId,
      view: () => actionView(latest.current),
      reveal: (tab) => {
        shell().setViewMode("ide");
        shell().setTab(tab);
        shell().setInspectorCollapsed(false);
      },
      openFile: (path, range) => asks().files.open(path, range),
      refreshChanges: () => asks().inspector.refreshChanges(),
      focusReview: (path) => asks().inspector.focusReview(path),
      openTerminal: () => {
        shell().setViewMode("ide");
        shell().setTerminalExpanded(true);
      },
      openTerminalTab: (id, command) => asks().terminals.open(id, command),
      requestPreview: (port, path) =>
        asks().inspector.requestPreview(port, path),
      selectWorktree: (id) => shell().selectWorktree(id),
      addWorktree: (worktree) => shell().addWorktree(worktree),
      openShare: (who) => {
        if (who) asks().chat.prefillShare(who);
        shell().setShareOpen(true);
      },
      openSettings: () => shell().setSettingsOpen(true),
      createChat: (provider) => shell().createChat(provider),
      setDraft: (text) => asks().chat.requestDraft(text),
      renameChat: (title) => renameActiveChat(workspaceId, shell(), title),
    };
  }, [workspaceId, latest]);
}

/** What the chat reads live: the open file's selection, the terminal on screen. */
function useLiveReaders(latest: Latest) {
  return useMemo(
    () => ({
      selection: () => {
        const { readers, inspector } = latest.current.requests;
        const selected = readers.selection();
        // A selection belongs to the open file; a closed file's is stale.
        return selected?.path === inspector.openFilePath ? selected : null;
      },
      terminalTail: () => {
        const { bindings: b, requests: r } = latest.current;
        if (!b.terminalExpanded) return null;
        const text = r.readers.tail(r.terminals.activeId);
        return text.trim() ? { worktreeId: b.worktreeId, text } : null;
      },
    }),
    [latest],
  );
}

function useAgentContextValue(
  bindings: WorkspaceShellBindings,
  requests: Requests,
  controller: WorkspaceController,
  latest: Latest,
): WorkspaceAgentContextValue {
  const { inspector, chat } = requests;
  const readers = useLiveReaders(latest);
  const sources = useWorkspaceAgentSources({
    ...bindings,
    ...readers,
    activeChatId: bindings.activeChat?.id ?? null,
  });
  const getSnapshot = useWorkspaceSnapshot(
    {
      ...bindings,
      inspector: bindings.inspectorCollapsed ? null : bindings.tab,
      terminalOpen: bindings.terminalExpanded,
      openFilePath: inspector.openFilePath,
      preview: inspector.preview,
      listeningPorts: inspector.preview.listeningPorts,
      runs: sources.agentRuns,
    },
    { selection: readers.selection, narrow: bindings.isNarrow },
  );
  const { canEdit, previewEnabled } = bindings;
  const { draftRequest, consumeDraftRequest } = chat;
  return useMemo(
    () => ({
      controller,
      getSnapshot,
      canEdit,
      previewEnabled,
      sources,
      draftRequest,
      consumeDraftRequest,
    }),
    [
      controller,
      getSnapshot,
      canEdit,
      previewEnabled,
      sources,
      draftRequest,
      consumeDraftRequest,
    ],
  );
}

/**
 * The workspace as agents and slash commands drive it: the controller the
 * chat calls, the context it reads, and the requests the panes consume (a
 * file to open, a review to focus, a preview to load, a share prefill,
 * terminal tabs). Everything it hands out is stable and reads the latest
 * shell state.
 */
export function useWorkspaceController(bindings: WorkspaceShellBindings) {
  const requests = useWorkspaceRequests(bindings.worktreeId);
  const latest = useRef({ bindings, requests });
  useLayoutEffect(() => {
    latest.current = { bindings, requests };
  });
  const ops = useActionOps(bindings.workspaceId, latest);
  const controller = useMemo<WorkspaceController>(() => {
    const shell = () => latest.current.bindings;
    return {
      autoRunBlocker: (action) => workspaceActionBlocker(action, ops.view()),
      run: (action) => runWorkspaceAction(action, ops),
      newChat: async (provider) => {
        if (provider) await shell().createChat(provider);
        else shell().handleNewChat();
      },
      openSettings: () => shell().setSettingsOpen(true),
      openImport: () => shell().setImportOpen(true),
      setViewMode: (mode) => shell().setViewMode(mode),
    };
  }, [ops]);
  const value = useAgentContextValue(bindings, requests, controller, latest);
  return { value, requests };
}

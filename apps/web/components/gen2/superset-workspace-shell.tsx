"use client";

import { workspaceStartupProgress } from "@/lib/gen2/startup-progress";

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useWorkspaceConnection } from "./use-workspace-connection";
import { useAgentOverlaps } from "./use-agent-overlaps";
import { SessionImportDialog } from "./session-import-dialog";
import {
  Check,
  ChevronDown,
  GitBranch,
  Pencil,
  Plus,
  Upload,
} from "lucide-react";
import type {
  Gen2AgentProviderName,
  Gen2Chat,
  Gen2WorkspaceDetail,
} from "@codev/contracts";
import { parseGitStatus } from "@/lib/runtime/ide";

import { WorkspaceButton } from "./workspace-button";
import { BranchStatusPill } from "./branch-status-pill";
import { WorkspaceTopBar } from "./workspace-top-bar";
import { cn } from "@/lib/platform/utils";
import { WorkspaceShareDialog } from "./workspace-share-dialog";
import { WorkspaceSettingsDialog } from "./workspace-settings-dialog";
import { Gen2ChatPanel } from "./chat-panel";
import { useWorkspaceController } from "./use-workspace-controller";
import { useWorkspaceInspectorSize } from "./use-workspace-inspector-size";
import type { WorkspaceInspectorTab } from "./workspace-action-run";
import { WorkspaceBrowserPane } from "./workspace-browser-pane";
import {
  WorkspaceAgentContext,
  type WorkspaceAgentContextValue,
} from "./workspace-controller";
import { WorkspaceTerminalDock } from "./workspace-terminal-dock";
import { WorkspaceLoading } from "./workspace-loading";
import { WorkspaceStartupSteps } from "./workspace-startup-steps";
import { WorkspaceSwitchDialog } from "./workspace-switch-dialog";
import {
  DEFAULT_SUPERSET_WORKTREE_ID,
  listSupersetWorktrees,
  SupersetFileApiError,
} from "./superset-file-client";
import { SupersetFilePane } from "./superset-file-pane";
import { openRemoteBranch } from "./open-remote-branch";
import { SupersetChangesPane } from "./superset-changes-pane";
import {
  SupersetWorkspacesBoard,
  type BoardWorktreeItem,
} from "./superset-workspaces-board";
import { SupersetAgentSessionsPanel } from "./superset-agent-sessions-panel";
import { withPrimaryWorktree, worktreeDisplay } from "./worktree-display";
import { WorktreeName } from "./worktree-name";
import { WorkspaceWorktreeForm } from "./workspace-worktree-form";
import { useWorkspaceViewUrl } from "./use-workspace-view-url";
import { useRealtimeFocus } from "./use-realtime-focus";
import { useWorkspaceRealtime } from "./use-workspace-realtime";
import { useWorkspacePresence } from "./use-workspace-presence";
import { WorkspacePresenceStack } from "./workspace-presence-stack";
import { useShellLiveUpdates } from "./use-shell-live-updates";
import { useWorkspaceFollow } from "./use-workspace-follow";
import { WorkspaceFollowFrame } from "./workspace-follow-frame";
import { useWorkspaceActivityToasts } from "./use-workspace-activity-toasts";
import type { WorkspaceView } from "./workspace-view-url";
import { SupersetAgentOverlapMenu } from "./superset-agent-overlap-menu";
import {
  ProviderLogo,
  SUPPORTED_AI_PROVIDERS,
  type SupportedAiProvider,
} from "./provider-logos";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

type Tab = WorkspaceInspectorTab;

type Worktree = { worktreeId: string; branch: string };

/** Auto-collapse the left rail below this viewport. User toggles pin the choice. */
export const GEN2_SIDEBAR_COLLAPSE_QUERY = "(max-width: 1279px)";
/** Auto-collapse the inspector below this viewport. User toggles pin the choice. */
export const GEN2_INSPECTOR_COLLAPSE_QUERY = "(max-width: 1023px)";
/** How often a working agent's status is reread while one is running. */
const RUNS_REFRESH_MS = 30_000;

const isInspectorNarrow = () =>
  window.matchMedia(GEN2_INSPECTOR_COLLAPSE_QUERY).matches;

function formatRelativeTime(dateString?: string) {
  if (!dateString) return "Just now";
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (isNaN(diffSec) || diffSec < 60) return "Just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return "Just now";
  }
}

function errorMessage(error: unknown, fallback: string) {
  if (!(error instanceof SupersetFileApiError) || error.status === 503)
    return fallback;
  return error.message;
}

function changedPaths(status: string) {
  return [...parseGitStatus(status)].map(([path, code]) => ({ path, code }));
}

async function readGit(
  workspaceId: string,
  worktreeId: string,
  operation: "status" | "diff",
) {
  const query = new URLSearchParams({ worktreeId, operation });
  const response = await fetch(
    `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/git?${query}`,
  );
  const payload = (await response.json().catch(() => ({}))) as {
    output?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error ?? "Couldn’t read Git.");
  }
  return payload.output ?? "";
}

/** The agent context reaches the chat, the terminal dock and the inspector. */
function ShellProviders({
  agent,
  children,
}: {
  agent: WorkspaceAgentContextValue;
  children: ReactNode;
}) {
  return (
    <WorkspaceAgentContext.Provider value={agent}>
      <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
    </WorkspaceAgentContext.Provider>
  );
}

/**
 * The workspace you are already in. Branches are worktrees on this
 * workspace's machine, so people and agents can work without sharing a
 * checkout. The terminal is that machine. Files, changes, and review read
 * the selected branch.
 */
export function SupersetWorkspaceShell({
  workspace,
  workspaceId,
  currentUserId,
  canEdit,
  runtimeEnabled,
  previewEnabled = false,
  initialView,
}: {
  workspace?: Gen2WorkspaceDetail | undefined;
  workspaceId: string;
  currentUserId?: string | undefined;
  canEdit: boolean;
  runtimeEnabled: boolean;
  /** Shows the Browser tab; on only where a preview zone is configured. */
  previewEnabled?: boolean | undefined;
  /** Where the member was, from the page URL: kept across a refresh. */
  initialView?: WorkspaceView | undefined;
}) {
  const [tab, setTab] = useState<Tab>(() =>
    initialView?.tab && (initialView.tab !== "browser" || previewEnabled)
      ? initialView.tab
      : "files",
  );
  const [worktrees, setWorktrees] = useState<Worktree[]>([
    { worktreeId: DEFAULT_SUPERSET_WORKTREE_ID, branch: "main" },
  ]);
  const [worktreeId, setWorktreeId] = useState(
    initialView?.worktreeId ?? DEFAULT_SUPERSET_WORKTREE_ID,
  );
  const [worktreesLoaded, setWorktreesLoaded] = useState(false);
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false);
  const [pendingWorktreeId, setPendingWorktreeId] = useState<string | null>(
    null,
  );
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [terminalExpanded, setTerminalExpanded] = useState(
    initialView?.terminal ?? false,
  );
  const [viewMode, setViewMode] = useState<"ide" | "board">(
    initialView?.board ? "board" : "ide",
  );
  const [shareOpen, setShareOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providersRevision, setProvidersRevision] = useState(0);
  const [activeRuns, setActiveRuns] = useState<
    Array<{
      id: string;
      chatId?: string | null;
      createdBy: string;
      worktreeId: string;
      status: string;
      provider: string;
      lastError: string | null;
      updatedAt: string;
    }>
  >([]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [branchLoadError, setBranchLoadError] = useState(false);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const [chats, setChats] = useState<Gen2Chat[]>([]);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(
    initialView?.chatId ?? null,
  );
  const [activeProvider, setActiveProvider] =
    useState<SupportedAiProvider>("codex");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const sidebarFollowViewport = useRef(true);
  const inspectorFollowViewport = useRef(true);
  const [worktreeDropdownOpen, setWorktreeDropdownOpen] = useState(false);
  const worktreeDropdownRef = useRef<HTMLDivElement>(null);
  const [providerStatuses, setProviderStatuses] = useState<
    Record<SupportedAiProvider, { connected: boolean; via: string | null }>
  >({
    codex: { connected: false, via: null },
    claude: { connected: false, via: null },
    cursor: { connected: false, via: null },
  });
  const [providerStatusesLoaded, setProviderStatusesLoaded] = useState(false);

  const [chatProviders, setChatProviders] = useState<
    Record<string, SupportedAiProvider>
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = sessionStorage.getItem(
        `codev-chat-providers:${workspaceId}`,
      );
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const recordChatProvider = useCallback(
    (cId: string, prov: SupportedAiProvider) => {
      setChatProviders((prev) => {
        const next = { ...prev, [cId]: prov };
        try {
          sessionStorage.setItem(
            `codev-chat-providers:${workspaceId}`,
            JSON.stringify(next),
          );
        } catch {}
        return next;
      });
    },
    [workspaceId],
  );

  const refreshProviderStatuses = useCallback(async () => {
    try {
      const res = await fetch("/api/gen2/providers?provider=all");
      if (!res.ok) return;
      const data = (await res.json()) as Partial<
        Record<
          SupportedAiProvider,
          { connected?: boolean; via?: string | null }
        >
      >;
      const status = (provider: SupportedAiProvider) => ({
        connected: data[provider]?.connected === true,
        via: data[provider]?.via ?? null,
      });
      setProviderStatuses({
        codex: status("codex"),
        claude: status("claude"),
        cursor: status("cursor"),
      });
      setProviderStatusesLoaded(true);
      if (!data[activeProvider]?.connected) {
        if (data.codex?.connected) setActiveProvider("codex");
        else if (data.claude?.connected) setActiveProvider("claude");
      }
    } catch {
      /* Background check */
    }
  }, [activeProvider]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void refreshProviderStatuses();
    }, 0);
    return () => clearTimeout(timeout);
  }, [refreshProviderStatuses]);

  // An account connected from the settings dialog is usable at once: the
  // shell's list and the chat panel's status and models both reload.
  const providersChanged = useCallback(() => {
    void refreshProviderStatuses();
    setProvidersRevision((revision) => revision + 1);
  }, [refreshProviderStatuses]);

  const refreshChats = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/chats`,
      );
      if (!res.ok) return;
      const payload = (await res.json()) as { chats?: Gen2Chat[] };
      const loaded = payload.chats ?? [];
      setChats(loaded);
      setSelectedChatId((curr) => curr ?? loaded[0]?.id ?? null);
    } catch {
      /* Background check */
    }
  }, [workspaceId]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void refreshChats();
    }, 0);
    return () => clearTimeout(timeout);
  }, [refreshChats]);

  const createChat = useCallback(
    async (provider: Gen2AgentProviderName) => {
      try {
        const response = await fetch(
          `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/chats`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider }),
          },
        );
        if (!response.ok) return null;
        const { chat } = (await response.json()) as { chat: Gen2Chat };
        setChats((prev) => [chat, ...prev.filter((c) => c.id !== chat.id)]);
        setSelectedChatId(chat.id);
        setActiveProvider(provider);
        recordChatProvider(chat.id, provider);
        return chat;
      } catch {
        return null;
      }
    },
    [workspaceId, recordChatProvider],
  );

  const connectedChatProviders = SUPPORTED_AI_PROVIDERS.filter(
    (
      provider,
    ): provider is (typeof SUPPORTED_AI_PROVIDERS)[number] & {
      id: Gen2AgentProviderName;
    } => providerStatuses[provider.id]?.connected,
  );

  const handleNewChat = useCallback(() => {
    if (!providerStatusesLoaded || connectedChatProviders.length === 0) return;
    if (connectedChatProviders.length === 1) {
      void createChat(connectedChatProviders[0]!.id);
      return;
    }
    setShowProviderPicker(true);
  }, [connectedChatProviders, createChat, providerStatusesLoaded]);

  function beginRename(chat: Gen2Chat) {
    if (renamePending) return;
    setRenamingChatId(chat.id);
    setRenameDraft(chat.title);
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    const chatId = renamingChatId;
    const title = renameDraft.trim();
    if (!chatId || !title || renamePending) return;
    const current = chats.find((chat) => chat.id === chatId);
    if (current?.title === title) {
      setRenamingChatId(null);
      return;
    }
    setRenamePending(true);
    try {
      const response = await fetch(
        `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/chats/${encodeURIComponent(chatId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        chat?: Gen2Chat;
        error?: string;
      } | null;
      if (!response.ok || !payload?.chat?.title) {
        setNotice(payload?.error || "Couldn't rename that chat.");
        return;
      }
      const savedTitle = payload.chat.title;
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId ? { ...chat, title: savedTitle } : chat,
        ),
      );
      setRenamingChatId(null);
      setNotice("");
    } catch {
      setNotice("Couldn't rename that chat.");
    } finally {
      setRenamePending(false);
    }
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        worktreeDropdownRef.current &&
        !worktreeDropdownRef.current.contains(event.target as Node)
      ) {
        setWorktreeDropdownOpen(false);
      }
    }
    if (!worktreeDropdownOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setWorktreeDropdownOpen(false);
      worktreeDropdownRef.current
        ?.querySelector<HTMLElement>("button")
        ?.focus();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [worktreeDropdownOpen]);

  useLayoutEffect(() => {
    const sidebarMq = window.matchMedia(GEN2_SIDEBAR_COLLAPSE_QUERY);
    const inspectorMq = window.matchMedia(GEN2_INSPECTOR_COLLAPSE_QUERY);

    const apply = () => {
      if (sidebarFollowViewport.current) {
        setSidebarCollapsed(
          window.matchMedia(GEN2_SIDEBAR_COLLAPSE_QUERY).matches,
        );
      }
      if (inspectorFollowViewport.current) {
        setInspectorCollapsed(
          window.matchMedia(GEN2_INSPECTOR_COLLAPSE_QUERY).matches,
        );
      }
    };

    apply();
    sidebarMq.addEventListener("change", apply);
    inspectorMq.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(document.documentElement);
    return () => {
      sidebarMq.removeEventListener("change", apply);
      inspectorMq.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
      observer?.disconnect();
    };
  }, []);

  const collapseSidebarByUser = useCallback((collapsed: boolean) => {
    sidebarFollowViewport.current = false;
    setSidebarCollapsed(collapsed);
  }, []);

  const toggleSidebarByUser = useCallback(() => {
    sidebarFollowViewport.current = false;
    setSidebarCollapsed((collapsed) => !collapsed);
  }, []);

  const toggleInspectorByUser = useCallback(() => {
    inspectorFollowViewport.current = false;
    setInspectorCollapsed((collapsed) => !collapsed);
  }, []);

  const activeWorkspace: Gen2WorkspaceDetail = workspace ?? {
    id: workspaceId,
    name: "Workspace",
    role: canEdit ? "editor" : "viewer",
    status: "ready",
    repository: null,
    sandboxId: null,
    runtimeProvider: "firecracker",
    runtimeStatus: "stopped",
    runtimeGeneration: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    members: [],
  };

  // Truthful branch file status: unknown counts are NEVER rendered as "Clean"
  const getBranchStatus = useCallback(
    (
      wtId: string,
    ): { label: string; tone: "clean" | "changes" | "unknown" } => {
      const count = fileCounts[wtId];
      if (count === undefined) {
        return { label: "—", tone: "unknown" };
      }
      if (count === 0) {
        return { label: "Clean", tone: "clean" };
      }
      return {
        label: `${count} ${count === 1 ? "file" : "files"}`,
        tone: "changes",
      };
    },
    [fileCounts],
  );

  const [refreshToken, setRefreshToken] = useState(0);

  const [connectedWorkspace, setConnectedWorkspace] =
    useState<Gen2WorkspaceDetail | null>(null);
  const connection = useWorkspaceConnection(
    workspaceId,
    runtimeEnabled,
    (next) => {
      setConnectedWorkspace(next);
      setNotice("");
    },
  );
  const overlaps = useAgentOverlaps(
    workspaceId,
    runtimeEnabled && connection.state === "connected",
  );
  const branchFor = (id: string) => {
    const worktree = worktrees.find((wt) => wt.worktreeId === id);
    return worktree ? worktreeDisplay(worktree).text : id;
  };
  const realtime = useWorkspaceRealtime();
  const presence = useWorkspacePresence(worktreeId);
  const memberLabel = (userId: string) => {
    const member = realtime.members.find((m) => m.userId === userId);
    return member?.name ?? member?.login ?? "a member";
  };
  const overlapsInWorktree = (id: string) =>
    overlaps.filter((overlap) =>
      activeRuns.some(
        (run) => run.id === overlap.runId && run.worktreeId === id,
      ),
    );
  const [showSwitchDialog, setShowSwitchDialog] = useState(false);
  const ensureRunning = connection.reconnect;
  const currentWorkspace = {
    ...activeWorkspace,
    ...connectedWorkspace,
    status:
      connection.state === "connected"
        ? ("ready" as const)
        : connection.state === "connecting" || connection.state === "checking"
          ? ("provisioning" as const)
          : ("stopped" as const),
  };

  const refreshRuns = useCallback(async () => {
    if (!runtimeEnabled) return;
    try {
      const res = await fetch(
        `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/superset/runs`,
      );
      if (!res.ok) return;
      const payload = (await res.json()) as { runs?: typeof activeRuns };
      if (Array.isArray(payload.runs)) {
        setActiveRuns(payload.runs);
        if (
          payload.runs.some(
            (r) => r.status === "running" || r.status === "creating",
          )
        ) {
          setAgentRunning(true);
        }
      }
    } catch {
      /* Background polling */
    }
  }, [runtimeEnabled, workspaceId]);

  const stopRun = useCallback(
    async (runId: string) => {
      setStoppingRunId(runId);
      try {
        const response = await fetch(
          `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/superset/runs/${encodeURIComponent(runId)}`,
          { method: "DELETE" },
        );
        if (!response.ok) throw new Error("Couldn’t stop the agent session.");
        await refreshRuns();
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "Couldn’t stop the agent session.",
        );
      } finally {
        setStoppingRunId(null);
      }
    },
    [refreshRuns, workspaceId],
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      void refreshRuns();
    }, 0);
    return () => clearTimeout(timeout);
  }, [refreshRuns]);

  // Runs are database rows, so rereading them never wakes the machine. Keep
  // a working agent's status current until it finishes.
  const runsActive = activeRuns.some((run) =>
    ["creating", "running", "stopping"].includes(run.status),
  );
  useEffect(() => {
    if (!runsActive) return;
    const interval = setInterval(() => void refreshRuns(), RUNS_REFRESH_MS);
    return () => clearInterval(interval);
  }, [runsActive, refreshRuns]);

  const boardItems: BoardWorktreeItem[] = worktrees.map((wt) => {
    const run = activeRuns.find((r) => r.worktreeId === wt.worktreeId);
    const shared = overlapsInWorktree(wt.worktreeId);
    const count = fileCounts[wt.worktreeId];
    const changesKnown = count !== undefined;
    let agentStatus: BoardWorktreeItem["agentStatus"] = "idle";
    if (run) {
      if (run.status === "running" || run.status === "creating") {
        agentStatus = "working";
      } else if (
        run.status === "failed" ||
        run.status === "recovery_required"
      ) {
        agentStatus = "attention";
      }
    } else if (changesKnown && count > 0) {
      agentStatus = "review";
    }

    return {
      worktreeId: wt.worktreeId,
      branch: wt.branch,
      fileCount: count ?? 0,
      changesKnown,
      agentStatus,
      agentError: run?.lastError ?? null,
      agentProvider: run?.provider ?? null,
      lastActivity: run?.updatedAt,
      overlap:
        shared.length > 0
          ? {
              branches: [
                ...new Set(shared.map((o) => branchFor(o.otherWorktreeId))),
              ],
              files: new Set(shared.map((o) => o.path)).size,
            }
          : undefined,
    };
  });

  const refreshCounts = useCallback(
    async (next: Worktree[]) => {
      if (!runtimeEnabled) return;
      const counts: Record<string, number> = {};
      await Promise.all(
        next.map(async (worktree) => {
          try {
            const status = await readGit(
              workspaceId,
              worktree.worktreeId,
              "status",
            );
            counts[worktree.worktreeId] = changedPaths(status).length;
          } catch {
            // A missing count stays blank/undefined. Never falsely assume clean.
          }
        }),
      );
      setFileCounts(counts);
    },
    [runtimeEnabled, workspaceId],
  );

  const refreshWorktrees = useCallback(async () => {
    if (!runtimeEnabled) return;
    try {
      const next = await listSupersetWorktrees(workspaceId);
      const listed = withPrimaryWorktree(next);
      setWorktrees(listed);
      setWorktreesLoaded(true);
      void refreshCounts(listed);
      setBranchLoadError(false);
    } catch {
      setBranchLoadError(true);
    }
  }, [refreshCounts, runtimeEnabled, workspaceId]);

  useEffect(() => {
    if (connection.state !== "connected") return;
    queueMicrotask(() => {
      setRefreshToken((value) => value + 1);
      void refreshWorktrees();
    });
  }, [connection.state, refreshWorktrees]);

  // Agents and terminals can create Git worktrees outside the browser flow.
  // Refresh when the switcher opens so those branches appear immediately.
  useEffect(() => {
    if (worktreeDropdownOpen && connection.state === "connected") {
      queueMicrotask(() => void refreshWorktrees());
    }
  }, [connection.state, refreshWorktrees, worktreeDropdownOpen]);

  // A brand-new workspace starts immediately. A sleeping one starts from the
  // connection check that runs because this page was opened.
  const bootedRef = useRef(false);
  useEffect(() => {
    if (
      !runtimeEnabled ||
      bootedRef.current ||
      !workspace ||
      workspace.status !== "pending"
    )
      return;
    bootedRef.current = true;
    void ensureRunning();
  }, [ensureRunning, runtimeEnabled, workspace]);

  // Protected worktree selection with shadcn AlertDialog confirmation when dirty
  const selectWorktree = useCallback(
    (next: string) => {
      if (next === worktreeId) return true;
      if (dirty) {
        setPendingWorktreeId(next);
        setShowDiscardDialog(true);
        return false;
      }
      setWorktreeId(next);
      setDirty(false);
      setNotice("");
      return true;
    },
    [dirty, worktreeId],
  );

  const confirmDiscardAndSwitch = useCallback(() => {
    if (pendingWorktreeId) {
      setWorktreeId(pendingWorktreeId);
      setDirty(false);
      setNotice("");
      setPendingWorktreeId(null);
    }
    setShowDiscardDialog(false);
  }, [pendingWorktreeId]);

  const cancelDiscard = useCallback(() => {
    setPendingWorktreeId(null);
    setShowDiscardDialog(false);
  }, []);

  function handleWorktreeCreated(created: Worktree) {
    setWorktrees((current) => [...current, created]);
    setShowCreate(false);
    const name = worktreeDisplay(created).text;
    setNotice(
      selectWorktree(created.worktreeId)
        ? `Created and selected ${name}.`
        : `Created ${name}. Your current unsaved changes were preserved.`,
    );
  }

  // Opens a branch from the top bar: switch to its worktree if one exists,
  // otherwise check it out from origin into a worktree of its own.
  async function openBranch(branch: string) {
    const existing = worktrees.find((worktree) => worktree.branch === branch);
    if (existing) {
      selectWorktree(existing.worktreeId);
      return;
    }
    setNotice(`Opening ${branch}…`);
    try {
      const created = await openRemoteBranch(workspaceId, branch, worktrees);
      setWorktrees((current) => [...current, created]);
      setNotice(
        selectWorktree(created.worktreeId)
          ? `Opened ${created.branch} in a new worktree.`
          : `Opened ${created.branch}. Your current unsaved changes were preserved.`,
      );
    } catch (error) {
      setNotice(errorMessage(error, `Couldn’t open ${branch}.`));
    }
  }

  const selected =
    worktrees.find((worktree) => worktree.worktreeId === worktreeId) ??
    worktrees[0];
  const selectedWorktree = selected ?? {
    worktreeId: DEFAULT_SUPERSET_WORKTREE_ID,
    branch: "main",
  };
  const selectedName = worktreeDisplay(selectedWorktree).text;
  const selectedStatus = selected ? getBranchStatus(selected.worktreeId) : null;

  const activeChat =
    chats.find((chat) => chat.id === selectedChatId) ?? chats[0] ?? null;

  const connectedProviders = SUPPORTED_AI_PROVIDERS.filter(
    (p) => providerStatuses[p.id]?.connected,
  );
  // A chat stays under the agent it started with. The server records it; the
  // session map only covers a chat created before that record existed.
  // Unknown legacy chats sit under the first connected agent, never under
  // whichever agent happens to be selected.
  const chatProviderOf = (chat: Gen2Chat) =>
    chat.provider ?? chatProviders[chat.id] ?? connectedProviders[0]?.id;

  const agent = useWorkspaceController({
    workspaceId,
    canEdit,
    previewEnabled,
    connected: connection.state === "connected",
    viewMode,
    setViewMode,
    tab,
    setTab,
    inspectorCollapsed,
    setInspectorCollapsed,
    isNarrow: isInspectorNarrow,
    terminalExpanded,
    setTerminalExpanded,
    worktreeId,
    worktrees,
    addWorktree: (created) => setWorktrees((current) => [...current, created]),
    // An agent's request never opens the discard dialog; it reports instead.
    selectWorktree: (id) => !dirty && selectWorktree(id),
    fileCounts,
    dirty,
    chats,
    setChats,
    activeChat,
    activeProvider,
    connectedProviders: connectedChatProviders.map((provider) => provider.id),
    createChat,
    handleNewChat,
    members: realtime.members,
    runs: activeRuns,
    refreshRuns: () => void refreshRuns(),
    setShareOpen,
    setSettingsOpen,
    setImportOpen,
  });
  const { files, inspector, terminals } = agent.requests;
  useShellLiveUpdates({
    currentUserId,
    role: activeWorkspace.role,
    refreshChanges: inspector.refreshChanges,
    refreshCounts: () => void refreshCounts(worktrees),
    refreshWorktrees: () => void refreshWorktrees(),
    refreshRuns: () => void refreshRuns(),
  });
  const follow = useWorkspaceFollow({
    people: presence.people,
    agents: presence.agents,
    worktreeId,
    dirty,
    selectWorktree: (id) => void selectWorktree(id),
    openFile: (path) => {
      setViewMode("ide");
      setInspectorCollapsed(false);
      if (inspector.openFilePath !== path) openFile(path);
    },
    showTab: (next) => {
      setViewMode("ide");
      setInspectorCollapsed(false);
      setTab(next);
    },
    selectChat: setSelectedChatId,
    onStopped: setNotice,
  });
  useWorkspaceActivityToasts({
    people: presence.people,
    currentChatId: selectedChatId ?? activeChat?.id ?? null,
    branchFor,
    onViewChanges: () => {
      setViewMode("ide");
      setTab("changes");
      setInspectorCollapsed(false);
    },
  });
  const inspectorSize = useWorkspaceInspectorSize(tab === "browser");
  const openFile = (path: string) =>
    void agent.value.controller.run({ type: "open_file", path });

  const view = {
    worktreeId,
    chatId: selectedChatId ?? activeChat?.id ?? null,
    tab,
    file: inspector.openFilePath,
    board: viewMode === "board",
    terminal: terminalExpanded,
  };
  useWorkspaceViewUrl(view);
  useRealtimeFocus({ ...view, inspectorCollapsed });
  // A worktree named in the link that no longer exists falls back to main.
  const worktreeMissing =
    worktreesLoaded &&
    !worktrees.some((worktree) => worktree.worktreeId === worktreeId);
  useEffect(() => {
    if (!worktreeMissing) return;
    queueMicrotask(() => setWorktreeId(DEFAULT_SUPERSET_WORKTREE_ID));
  }, [worktreeMissing]);
  // The file named in the link reopens once the machine answers.
  const linkedFile = useRef(initialView?.file ?? null);
  const requestFile = files.open;
  useEffect(() => {
    const path = linkedFile.current;
    if (!path || connection.state !== "connected") return;
    linkedFile.current = null;
    requestFile(path);
  }, [connection.state, requestFile]);

  if (!runtimeEnabled) {
    return (
      <>
        <p className="gen2-superset-runtime-notice" role="status">
          The workspace machine’s terminal, changes, and branches are disabled
          for this environment.
        </p>
        <SupersetFilePane
          workspaceId={workspaceId}
          canEdit={canEdit}
          workspaceReady={activeWorkspace.status === "ready"}
        />
      </>
    );
  }

  return (
    <ShellProviders agent={agent.value}>
      <div
        className="gen2-ide-container"
        data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
        data-inspector-collapsed={inspectorCollapsed ? "true" : "false"}
      >
        <WorkspaceTopBar
          workspaceName={activeWorkspace.name}
          repositoryName={activeWorkspace.repository?.fullName}
          branchMenu={{
            workspaceId,
            repositoryPrivate: activeWorkspace.repository?.private ?? false,
            branches: worktrees,
            selected,
            getStatus: getBranchStatus,
            loadError: Boolean(branchLoadError),
            onRetry: () => void refreshWorktrees(),
            onSelect: selectWorktree,
            onOpenRemote: canEdit
              ? (branch) => void openBranch(branch)
              : undefined,
            onCreate: canEdit
              ? () => {
                  collapseSidebarByUser(false);
                  setShowCreate(true);
                }
              : undefined,
          }}
          sessionTitle={activeChat?.title ?? null}
          sessionProvider={
            connectedProviders.some(
              (provider) => provider.id === activeProvider,
            )
              ? activeProvider
              : null
          }
          agentRunning={agentRunning}
          presence={
            <WorkspacePresenceStack
              people={presence.people}
              agents={presence.agents}
              branchFor={branchFor}
              onFollow={follow.follow}
            />
          }
          connectionState={connection.state}
          viewMode={viewMode}
          sidebarCollapsed={sidebarCollapsed}
          inspectorCollapsed={inspectorCollapsed}
          onReconnect={() => void ensureRunning()}
          onShare={() => setShareOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleViewMode={() =>
            setViewMode((m) => (m === "board" ? "ide" : "board"))
          }
          onToggleSidebar={toggleSidebarByUser}
          onToggleInspector={toggleInspectorByUser}
        />

        {viewMode === "board" ? (
          <main
            className={cn("gen2-ide", sidebarCollapsed && "sidebar-collapsed")}
            data-view-mode="board"
          >
            <aside
              className={cn(
                "gen2-ide-branches",
                sidebarCollapsed && "collapsed",
              )}
              aria-label="Branches"
            >
              {sidebarCollapsed ? (
                <div className="gen2-sidebar-compact">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <WorkspaceButton
                        tone="ghost"
                        size="icon"
                        type="button"
                        className="gen2-sidebar-compact-btn"
                        onClick={() => collapseSidebarByUser(false)}
                        aria-label={`Active worktree: ${selectedName}`}
                      >
                        <GitBranch className="size-4 text-foreground/80" />
                        {worktrees.length > 1 ? (
                          <span className="gen2-sidebar-compact-badge">
                            {worktrees.length}
                          </span>
                        ) : null}
                      </WorkspaceButton>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {`Active worktree: ${selectedName} (${worktrees.length} ${worktrees.length === 1 ? "worktree" : "worktrees"})`}
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <WorkspaceButton
                        tone="primary"
                        size="icon"
                        type="button"
                        className="gen2-sidebar-compact-btn primary"
                        onClick={handleNewChat}
                        disabled={
                          !providerStatusesLoaded ||
                          connectedChatProviders.length === 0
                        }
                        aria-label="New Chat"
                      >
                        <Plus size={16} strokeWidth={2.5} />
                      </WorkspaceButton>
                    </TooltipTrigger>
                    <TooltipContent side="right">New Chat</TooltipContent>
                  </Tooltip>

                  {activeWorkspace.role !== "viewer" ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <WorkspaceButton
                          size="icon"
                          className="gen2-sidebar-compact-btn"
                          onClick={() => setImportOpen(true)}
                          aria-label="Import a local session"
                        >
                          <Upload aria-hidden="true" />
                        </WorkspaceButton>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        Import a Codex or Claude Code session
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
              ) : (
                <div className="gen2-sidebar-section">
                  <div className="gen2-sidebar-section-header">
                    <span className="gen2-sidebar-section-title">
                      Active worktree
                    </span>
                  </div>
                  <div className="gen2-worktree-dropdown-wrapper">
                    <button
                      type="button"
                      className="gen2-worktree-trigger-btn"
                      onClick={() => setWorktreeDropdownOpen((open) => !open)}
                      aria-expanded={worktreeDropdownOpen}
                      aria-label={`Active worktree: ${selectedName}`}
                    >
                      <div className="gen2-worktree-trigger-left">
                        <GitBranch
                          size={14}
                          className="gen2-worktree-trigger-icon"
                        />
                        <span className="gen2-worktree-branch-name">
                          <WorktreeName worktree={selectedWorktree} />
                        </span>
                      </div>
                      <div className="gen2-worktree-trigger-right">
                        <BranchStatusPill
                          status={selectedStatus}
                          className="gen2-worktree-status-pill"
                        />
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </aside>
            <SupersetWorkspacesBoard
              items={boardItems}
              selectedWorktreeId={worktreeId}
              onSelectWorktree={(id) => {
                selectWorktree(id);
                setViewMode("ide");
              }}
              onCreateWorktree={canEdit ? () => setShowCreate(true) : undefined}
              canEdit={canEdit}
            />
          </main>
        ) : (
          <main className="gen2-ide-main-shell flex-1 h-[calc(100vh-48px)] min-h-0 overflow-hidden flex">
            {sidebarCollapsed ? (
              <aside
                className="gen2-ide-branches collapsed shrink-0 border-r border-border z-10"
                aria-label="Branches"
              >
                <div className="gen2-sidebar-compact">
                  <div
                    className="gen2-worktree-dropdown-wrapper"
                    ref={worktreeDropdownRef}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <WorkspaceButton
                          tone="ghost"
                          size="icon"
                          type="button"
                          className="gen2-sidebar-compact-btn"
                          onClick={() =>
                            setWorktreeDropdownOpen((open) => !open)
                          }
                          aria-expanded={worktreeDropdownOpen}
                          aria-label={`Active worktree: ${selectedName}`}
                        >
                          <GitBranch className="size-4 text-foreground/80" />
                          {worktrees.length > 1 ? (
                            <span className="gen2-sidebar-compact-badge">
                              {worktrees.length}
                            </span>
                          ) : null}
                        </WorkspaceButton>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {`Active worktree: ${selectedName} (${worktrees.length} ${worktrees.length === 1 ? "worktree" : "worktrees"})`}
                      </TooltipContent>
                    </Tooltip>
                    <div
                      className={cn(
                        "gen2-worktree-dropdown-menu gen2-worktree-dropdown-menu-compact",
                        worktreeDropdownOpen && "open",
                      )}
                      role="menu"
                    >
                      <div className="gen2-worktree-dropdown-header">
                        <span>Switch worktree</span>
                      </div>
                      <ul className="gen2-worktree-dropdown-list">
                        {worktrees.map((wt) => {
                          const isSelected = wt.worktreeId === worktreeId;
                          const st = getBranchStatus(wt.worktreeId);
                          return (
                            <li key={wt.worktreeId}>
                              <button
                                type="button"
                                className={cn(
                                  "gen2-worktree-dropdown-item",
                                  isSelected && "selected",
                                )}
                                onClick={() => {
                                  selectWorktree(wt.worktreeId);
                                  setWorktreeDropdownOpen(false);
                                }}
                              >
                                <span className="gen2-worktree-dropdown-item-branch">
                                  <WorktreeName worktree={wt} />
                                </span>
                                <BranchStatusPill
                                  status={st}
                                  className="gen2-worktree-status-pill"
                                />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>

                  {/* New Chat Button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <WorkspaceButton
                        tone="primary"
                        size="icon"
                        type="button"
                        className="gen2-sidebar-compact-btn primary"
                        onClick={handleNewChat}
                        disabled={
                          !providerStatusesLoaded ||
                          connectedChatProviders.length === 0
                        }
                        aria-label="New Chat"
                      >
                        <Plus size={16} strokeWidth={2.5} />
                      </WorkspaceButton>
                    </TooltipTrigger>
                    <TooltipContent side="right">New Chat</TooltipContent>
                  </Tooltip>

                  {activeWorkspace.role !== "viewer" ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <WorkspaceButton
                          size="icon"
                          className="gen2-sidebar-compact-btn"
                          onClick={() => setImportOpen(true)}
                          aria-label="Import a local session"
                        >
                          <Upload aria-hidden="true" />
                        </WorkspaceButton>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        Import a Codex or Claude Code session
                      </TooltipContent>
                    </Tooltip>
                  ) : null}

                  <div className="gen2-sidebar-compact-divider" />

                  {/* Connected Providers */}
                  <div className="gen2-sidebar-compact-providers">
                    {connectedProviders.map((provider) => (
                      <Tooltip key={provider.id}>
                        <TooltipTrigger asChild>
                          <WorkspaceButton
                            tone="ghost"
                            size="icon"
                            type="button"
                            className={cn(
                              "gen2-sidebar-compact-btn provider",
                              activeProvider === provider.id && "active",
                            )}
                            onClick={() => setActiveProvider(provider.id)}
                            aria-label={`${provider.name} provider`}
                          >
                            <ProviderLogo provider={provider.id} size={20} />
                          </WorkspaceButton>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {`${provider.name} (${chats.filter((c) => chatProviderOf(c) === provider.id).length} chats)`}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              </aside>
            ) : null}

            <ResizablePanelGroup
              direction="horizontal"
              className={cn(
                "gen2-ide flex-1",
                sidebarCollapsed && "sidebar-collapsed",
                inspectorCollapsed && "inspector-collapsed",
              )}
              data-view-mode="ide"
            >
              {!sidebarCollapsed ? (
                <>
                  <ResizablePanel
                    defaultSize="288px"
                    minSize="220px"
                    maxSize="360px"
                    groupResizeBehavior="preserve-pixel-size"
                    className="gen2-ide-branches"
                  >
                    <aside
                      className="h-full w-full overflow-hidden flex flex-col"
                      aria-label="Branches"
                    >
                      {/* Section 1: Active worktree */}
                      <div className="gen2-sidebar-section">
                        <div className="gen2-sidebar-section-header">
                          <span className="gen2-sidebar-section-title">
                            Active worktree
                          </span>
                        </div>

                        {/* Worktree Switcher Trigger */}
                        <div
                          className="gen2-worktree-dropdown-wrapper"
                          ref={worktreeDropdownRef}
                        >
                          <button
                            type="button"
                            className="gen2-worktree-trigger-btn"
                            onClick={() =>
                              setWorktreeDropdownOpen((open) => !open)
                            }
                            aria-expanded={worktreeDropdownOpen}
                            aria-label={`Active worktree: ${selectedName}`}
                          >
                            <div className="gen2-worktree-trigger-left">
                              <GitBranch
                                size={14}
                                className="gen2-worktree-trigger-icon"
                              />
                              <span className="gen2-worktree-branch-name">
                                <WorktreeName worktree={selectedWorktree} />
                              </span>
                            </div>
                            <div className="gen2-worktree-trigger-right">
                              <BranchStatusPill
                                status={selectedStatus}
                                className="gen2-worktree-status-pill"
                              />
                              <ChevronDown
                                size={14}
                                className={cn(
                                  "gen2-worktree-trigger-chevron",
                                  worktreeDropdownOpen && "open",
                                )}
                              />
                            </div>
                          </button>

                          {/* Worktrees Menu */}
                          <div
                            className={cn(
                              "gen2-worktree-dropdown-menu",
                              worktreeDropdownOpen && "open",
                            )}
                            role="menu"
                          >
                            <div className="gen2-worktree-dropdown-header">
                              <span>Switch worktree</span>
                            </div>
                            <ul className="gen2-worktree-dropdown-list">
                              {worktrees.map((wt) => {
                                const isSelected = wt.worktreeId === worktreeId;
                                const st = getBranchStatus(wt.worktreeId);
                                return (
                                  <li key={wt.worktreeId}>
                                    <button
                                      type="button"
                                      className={cn(
                                        "gen2-worktree-dropdown-item",
                                        isSelected && "selected",
                                      )}
                                      onClick={() => {
                                        selectWorktree(wt.worktreeId);
                                        setWorktreeDropdownOpen(false);
                                      }}
                                    >
                                      <div className="gen2-worktree-dropdown-item-left">
                                        <GitBranch
                                          size={14}
                                          className={cn(
                                            "gen2-worktree-dropdown-item-icon",
                                            isSelected && "selected",
                                          )}
                                        />
                                        <span className="gen2-worktree-dropdown-item-branch">
                                          <WorktreeName worktree={wt} />
                                        </span>
                                      </div>
                                      <div className="gen2-worktree-dropdown-item-right">
                                        <BranchStatusPill
                                          status={st}
                                          className="gen2-worktree-status-pill"
                                        />
                                        {isSelected ? (
                                          <Check
                                            size={13}
                                            className="gen2-worktree-dropdown-item-check"
                                          />
                                        ) : null}
                                      </div>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                            {canEdit ? (
                              <div className="gen2-worktree-dropdown-footer">
                                <WorkspaceButton
                                  tone="ghost"
                                  type="button"
                                  className="gen2-worktree-create-btn"
                                  onClick={() => {
                                    setShowCreate((current) => !current);
                                    setWorktreeDropdownOpen(false);
                                  }}
                                >
                                  <Plus size={13} />
                                  <span>New worktree</span>
                                </WorkspaceButton>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {/* Inline creation form if showCreate is open */}
                        {showCreate ? (
                          <WorkspaceWorktreeForm
                            workspaceId={workspaceId}
                            worktrees={worktrees}
                            currentWorktreeId={worktreeId}
                            repositoryPrivate={
                              activeWorkspace.repository?.private ?? false
                            }
                            onCreated={handleWorktreeCreated}
                            onCancel={() => setShowCreate(false)}
                          />
                        ) : null}
                      </div>

                      {/* Primary Action: + New Chat */}
                      <WorkspaceButton
                        tone="secondary"
                        size="action"
                        type="button"
                        className="gen2-sidebar-new-chat-btn"
                        onClick={handleNewChat}
                        disabled={
                          !providerStatusesLoaded ||
                          connectedChatProviders.length === 0
                        }
                        aria-label="New Chat"
                      >
                        <div className="gen2-sidebar-new-chat-content">
                          <Plus size={14} strokeWidth={2.5} />
                          <span>New Chat</span>
                        </div>
                      </WorkspaceButton>

                      {/* Section 2: Recent chats */}
                      <div className="gen2-sidebar-section gen2-sidebar-recent-chats">
                        <div className="gen2-sidebar-section-header">
                          <span className="gen2-sidebar-section-title">
                            Recent chats
                          </span>
                          <span className="gen2-sidebar-section-actions">
                            {activeWorkspace.role !== "viewer" ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <WorkspaceButton
                                    size="icon"
                                    aria-label="Import a local session"
                                    onClick={() => setImportOpen(true)}
                                  >
                                    <Upload aria-hidden="true" />
                                  </WorkspaceButton>
                                </TooltipTrigger>
                                <TooltipContent side="right">
                                  Import a Codex or Claude Code session
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </span>
                        </div>

                        {connectedProviders.length === 0 ? (
                          <div className="gen2-sidebar-no-providers">
                            <p className="text-xs text-muted-foreground">
                              Connect Codex or Claude to start a workspace chat.
                            </p>
                            <WorkspaceButton
                              tone="secondary"
                              className="mt-2"
                              onClick={() => setSettingsOpen(true)}
                            >
                              Connect an account
                            </WorkspaceButton>
                          </div>
                        ) : chats.length === 0 ? (
                          <Empty className="gen2-sidebar-chat-empty">
                            <EmptyHeader>
                              <EmptyTitle>No chats yet</EmptyTitle>
                              <EmptyDescription>
                                Start one with New Chat.
                              </EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        ) : (
                          <div className="gen2-sidebar-providers-list">
                            {connectedProviders.map((provider) => {
                              const providerChats = chats.filter(
                                (c) => chatProviderOf(c) === provider.id,
                              );
                              if (providerChats.length === 0) return null;

                              return (
                                <div
                                  key={provider.id}
                                  className="gen2-sidebar-provider-group"
                                >
                                  <div className="gen2-sidebar-provider-header">
                                    <div className="gen2-sidebar-provider-label">
                                      <ProviderLogo
                                        provider={provider.id}
                                        size={18}
                                        className="gen2-sidebar-provider-logo"
                                      />
                                      <span className="gen2-sidebar-provider-name">
                                        {provider.name}
                                      </span>
                                    </div>
                                  </div>

                                  <ul className="gen2-sidebar-chat-list">
                                    {providerChats.map((chat) => {
                                      const isSelected =
                                        chat.id ===
                                        (selectedChatId ?? chats[0]?.id);
                                      return (
                                        <li
                                          key={chat.id}
                                          className="gen2-sidebar-chat-item"
                                        >
                                          {renamingChatId === chat.id ? (
                                            <form
                                              className="gen2-sidebar-chat-rename-form"
                                              onSubmit={(event) =>
                                                void submitRename(event)
                                              }
                                            >
                                              <input
                                                aria-label="Chat title"
                                                value={renameDraft}
                                                maxLength={80}
                                                autoFocus
                                                disabled={renamePending}
                                                onChange={(event) =>
                                                  setRenameDraft(
                                                    event.target.value,
                                                  )
                                                }
                                                onKeyDown={(event) => {
                                                  if (
                                                    event.key === "Escape" &&
                                                    !renamePending
                                                  ) {
                                                    event.preventDefault();
                                                    setRenamingChatId(null);
                                                  }
                                                }}
                                              />
                                            </form>
                                          ) : (
                                            <>
                                              <button
                                                type="button"
                                                aria-current={
                                                  isSelected
                                                    ? "page"
                                                    : undefined
                                                }
                                                className={cn(
                                                  "gen2-sidebar-chat-card",
                                                  isSelected && "selected",
                                                )}
                                                onClick={() => {
                                                  setSelectedChatId(chat.id);
                                                  setActiveProvider(
                                                    provider.id,
                                                  );
                                                }}
                                                onDoubleClick={() =>
                                                  beginRename(chat)
                                                }
                                              >
                                                <span className="gen2-sidebar-chat-title">
                                                  {chat.title}
                                                </span>
                                                <div className="gen2-sidebar-chat-meta">
                                                  <span>
                                                    {chat.messageCount ?? 1}{" "}
                                                    msgs
                                                  </span>
                                                  <span className="gen2-sidebar-chat-dot">
                                                    •
                                                  </span>
                                                  <span>
                                                    {formatRelativeTime(
                                                      chat.updatedAt,
                                                    )}
                                                  </span>
                                                </div>
                                              </button>
                                              <WorkspaceButton
                                                tone="ghost"
                                                size="icon"
                                                className="gen2-sidebar-chat-rename"
                                                aria-label={`Rename ${chat.title}`}
                                                onClick={() =>
                                                  beginRename(chat)
                                                }
                                              >
                                                <Pencil aria-hidden="true" />
                                              </WorkspaceButton>
                                            </>
                                          )}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </aside>
                  </ResizablePanel>
                  <ResizableHandle className="gen2-ide-resizer" />
                </>
              ) : null}

              {/* Center Main Stage: Agent Chat & Docked Terminal */}
              <ResizablePanel
                minSize={inspectorSize.centerMinSize}
                className="gen2-ide-session-panel"
              >
                <section
                  className="gen2-ide-session"
                  aria-label="Workspace session"
                >
                  {notice ? (
                    <p className="gen2-superset-runtime-notice" role="status">
                      {notice}
                    </p>
                  ) : null}
                  <SupersetAgentSessionsPanel
                    runs={activeRuns}
                    chatTitle={(id) =>
                      chats.find((chat) => chat.id === id)?.title ?? null
                    }
                    branchFor={branchFor}
                    currentChatId={activeChat?.id ?? null}
                    canEdit={canEdit}
                    onOpen={(run) => {
                      if (!selectWorktree(run.worktreeId)) return;
                      if (run.chatId) setSelectedChatId(run.chatId);
                    }}
                    onStop={stopRun}
                    stoppingRunId={stoppingRunId}
                    renderOverlaps={(runId) => (
                      <SupersetAgentOverlapMenu
                        overlaps={overlaps.filter((o) => o.runId === runId)}
                        branchFor={branchFor}
                        memberLabel={memberLabel}
                        onOpenWorktree={(id) => {
                          if (!selectWorktree(id)) return;
                          setTab("changes");
                          setInspectorCollapsed(false);
                        }}
                      />
                    )}
                  />

                  {/* Middle part is ALWAYS the agent chat */}
                  <div
                    className="gen2-ide-chat-stage"
                    aria-busy={connection.state !== "connected"}
                  >
                    <div
                      className="gen2-ide-chat-body"
                      inert={
                        connection.state === "connected" ? undefined : true
                      }
                    >
                      <Gen2ChatPanel
                        workspace={currentWorkspace}
                        worktreeId={worktreeId}
                        activeChatId={selectedChatId}
                        onSelectChatId={setSelectedChatId}
                        onChatsChange={setChats}
                        connectedProviders={connectedChatProviders.map(
                          (provider) => provider.id,
                        )}
                        activeProvider={activeProvider}
                        onActiveProviderChange={setActiveProvider}
                        hideChatBar={true}
                        onRunningChange={setAgentRunning}
                        onFilesChanged={() => {
                          agent.value.sources.invalidateFiles();
                          void refreshWorktrees();
                        }}
                        onOpenFile={openFile}
                        onNeedsMachine={ensureRunning}
                        onOpenWorktree={(id) => {
                          // Another member's run may have made it since
                          // the list was last read.
                          if (!worktrees.some((wt) => wt.worktreeId === id))
                            void refreshWorktrees();
                          selectWorktree(id);
                          void agent.value.controller.run({
                            type: "show_changes",
                          });
                        }}
                        onOpenSettings={() => setSettingsOpen(true)}
                        providersRevision={providersRevision}
                      />
                    </div>
                    {connection.state === "connected" ? null : (
                      <>
                        <WorkspaceLoading
                          className="gen2-ide-loading"
                          detail={
                            connection.switching ? undefined : (
                              <WorkspaceStartupSteps
                                progress={connection.progress}
                              />
                            )
                          }
                          busy={
                            connection.switching ||
                            (!connection.subscriptionRequired &&
                              !connection.conflict &&
                              connection.state !== "disconnected")
                          }
                          title={
                            connection.conflict
                              ? connection.switching
                                ? "Switching active workspace"
                                : "Active workspace limit reached"
                              : connection.error &&
                                  /workspace minutes|monthly limit|quota/i.test(
                                    connection.error,
                                  )
                                ? "Monthly workspace time used"
                                : connection.error &&
                                    /budget guard|monthly resource budget/i.test(
                                      connection.error,
                                    )
                                  ? "Compute paused by budget guard"
                                  : connection.subscriptionRequired
                                    ? "An active paid plan is required"
                                    : connection.state === "disconnected"
                                      ? workspace?.status === "pending"
                                        ? "This workspace hasn't started"
                                        : "Can't connect to this workspace"
                                      : "Waking your workspace"
                          }
                          description={
                            connection.conflict
                              ? connection.switching
                                ? (connection.switchStatus ??
                                  "Switching workspaces…")
                                : workspace?.role === "owner"
                                  ? `“${connection.conflict.activeWorkspace.name}” is currently running. Free accounts can run one workspace at a time. Switch to stop it and start this workspace.`
                                  : `“${connection.conflict.activeWorkspace.name}” is currently running. Only the workspace owner can switch active workspaces.`
                              : connection.error &&
                                  /workspace minutes|monthly limit|quota/i.test(
                                    connection.error,
                                  )
                                ? connection.error
                                : connection.error &&
                                    /budget guard|monthly resource budget/i.test(
                                      connection.error,
                                    )
                                  ? connection.error
                                  : connection.subscriptionRequired
                                    ? connection.error ||
                                      "Workspace owners can subscribe in Settings, then open this workspace again."
                                    : connection.state === "disconnected"
                                      ? connection.error ||
                                        "Your files are still saved."
                                      : workspaceStartupProgress(
                                          connection.progress,
                                        )
                          }
                          action={
                            connection.conflict ? (
                              workspace?.role === "owner" ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <WorkspaceButton
                                    tone="primary"
                                    type="button"
                                    disabled={connection.switching}
                                    onClick={() => setShowSwitchDialog(true)}
                                  >
                                    Switch to this workspace
                                  </WorkspaceButton>
                                  <WorkspaceButton
                                    tone="secondary"
                                    type="button"
                                    disabled={connection.switching}
                                    onClick={() =>
                                      window.location.assign("/gen2")
                                    }
                                  >
                                    Back to workspaces
                                  </WorkspaceButton>
                                </div>
                              ) : (
                                <WorkspaceButton
                                  tone="secondary"
                                  type="button"
                                  onClick={() =>
                                    window.location.assign("/gen2")
                                  }
                                >
                                  Back to workspaces
                                </WorkspaceButton>
                              )
                            ) : connection.error &&
                              /workspace minutes|monthly limit|quota/i.test(
                                connection.error,
                              ) ? (
                              <WorkspaceButton
                                tone="secondary"
                                type="button"
                                onClick={() => {
                                  window.location.assign(
                                    "/settings/personal/billing",
                                  );
                                }}
                              >
                                View plan details
                              </WorkspaceButton>
                            ) : connection.error &&
                              /budget guard|monthly resource budget/i.test(
                                connection.error,
                              ) ? (
                              <WorkspaceButton
                                tone="secondary"
                                type="button"
                                onClick={() => {
                                  window.location.assign(
                                    "/settings/personal/billing",
                                  );
                                }}
                              >
                                View billing
                              </WorkspaceButton>
                            ) : connection.subscriptionRequired ? (
                              <WorkspaceButton
                                tone="secondary"
                                type="button"
                                onClick={() => {
                                  window.location.assign(
                                    "/settings/personal/billing",
                                  );
                                }}
                              >
                                Open billing
                              </WorkspaceButton>
                            ) : connection.state === "disconnected" ? (
                              <WorkspaceButton
                                tone="secondary"
                                type="button"
                                onClick={() => void ensureRunning()}
                              >
                                {workspace?.status === "pending"
                                  ? "Start workspace"
                                  : "Reconnect workspace"}
                              </WorkspaceButton>
                            ) : null
                          }
                        />
                        {connection.conflict && (
                          <WorkspaceSwitchDialog
                            open={showSwitchDialog}
                            onOpenChange={setShowSwitchDialog}
                            activeWorkspace={
                              connection.conflict.activeWorkspace
                            }
                            targetWorkspaceName={currentWorkspace.name}
                            switching={connection.switching}
                            switchStatus={connection.switchStatus}
                            onConfirmSwitch={() => {
                              setShowSwitchDialog(false);
                              void connection.switchWorkspace(
                                connection.conflict!.activeWorkspace.id,
                              );
                            }}
                          />
                        )}
                      </>
                    )}
                  </div>

                  <WorkspaceTerminalDock
                    workspaceId={workspaceId}
                    worktreeId={worktreeId}
                    branch={worktreeDisplay(selectedWorktree).label}
                    expanded={terminalExpanded}
                    onExpandedChange={setTerminalExpanded}
                    connection={
                      connection.state === "connected"
                        ? "ready"
                        : connection.subscriptionRequired
                          ? "blocked"
                          : connection.state === "disconnected"
                            ? "asleep"
                            : "waking"
                    }
                    onResumeWorkspace={ensureRunning}
                    tabs={terminals.tabs}
                    activeId={terminals.activeId}
                    onSelectTab={terminals.select}
                    onCloseTab={terminals.close}
                    onTailReader={agent.requests.readers.onTailReader}
                  />
                </section>
              </ResizablePanel>

              {/* Right Inspector: Files, Changes, Review, Browser */}
              {!inspectorCollapsed ? (
                <>
                  <ResizableHandle className="gen2-ide-resizer" />
                  <ResizablePanel
                    panelRef={inspectorSize.panelRef}
                    defaultSize="400px"
                    minSize="280px"
                    maxSize={inspectorSize.maxSize}
                    groupResizeBehavior="preserve-pixel-size"
                    className="gen2-ide-inspector"
                  >
                    <aside
                      className="h-full w-full overflow-hidden flex flex-col"
                      aria-label="Branch files"
                    >
                      <Tabs
                        value={tab}
                        onValueChange={(next) => setTab(next as Tab)}
                        className="contents"
                      >
                        <TabsList
                          aria-label="Branch files"
                          className="gen2-ide-tabs"
                        >
                          {(
                            [
                              ["files", "Files"],
                              ["changes", "Changes"],
                              ["review", "Review"],
                              ...(previewEnabled
                                ? [["browser", "Browser"] as const]
                                : []),
                            ] as const
                          ).map(([id, label]) => (
                            <TabsTrigger
                              key={id}
                              value={id}
                              id={`superset-tab-${id}`}
                              aria-controls={`superset-panel-${id}`}
                            >
                              {label}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </Tabs>
                      {connection.state === "disconnected" ? (
                        <Alert className="gen2-ide-offline-notice">
                          <AlertDescription>
                            Workspace offline. These are the files from your
                            last session, read-only.
                          </AlertDescription>
                        </Alert>
                      ) : null}
                      <div
                        id="superset-panel-files"
                        role="tabpanel"
                        aria-labelledby="superset-tab-files"
                        hidden={tab !== "files"}
                        className="gen2-ide-files"
                      >
                        <SupersetFilePane
                          key={worktreeId}
                          workspaceId={workspaceId}
                          canEdit={canEdit}
                          workspaceReady={connection.state === "connected"}
                          worktreeId={worktreeId}
                          refreshToken={refreshToken}
                          onDirtyChange={setDirty}
                          requestedPath={files.path}
                          onRequestedPathConsumed={files.consumed}
                          requestedRange={files.range}
                          onRangeRevealed={files.revealed}
                          onOpenFile={inspector.onOpenFile}
                          onSelectionText={
                            agent.requests.readers.onSelectionText
                          }
                          followCursorId={follow.position?.cursorId ?? null}
                        />
                      </div>
                      <SupersetChangesPane
                        workspaceId={workspaceId}
                        worktreeId={worktreeId}
                        visible={tab === "changes"}
                        mode="changes"
                        overlapFor={(path) => {
                          const match = overlapsInWorktree(worktreeId).find(
                            (o) => o.path === path,
                          );
                          return match
                            ? `Also changed by ${branchFor(match.otherWorktreeId)} (${match.otherProvider}, ${memberLabel(match.otherCreatedBy)})`
                            : undefined;
                        }}
                        onOpenFile={openFile}
                        refreshToken={inspector.changesToken}
                      />
                      <SupersetChangesPane
                        workspaceId={workspaceId}
                        worktreeId={worktreeId}
                        visible={tab === "review"}
                        mode="review"
                        onOpenFile={openFile}
                        refreshToken={inspector.changesToken}
                        focusPath={inspector.reviewFocus}
                      />
                      {previewEnabled ? (
                        <WorkspaceBrowserPane
                          workspaceId={workspaceId}
                          visible={tab === "browser"}
                          canEdit={canEdit}
                          connected={connection.state === "connected"}
                          request={inspector.previewRequest}
                          onExpandChange={inspectorSize.onExpandChange}
                          onStateChange={inspector.onPreviewState}
                        />
                      ) : null}
                    </aside>
                  </ResizablePanel>
                </>
              ) : null}
            </ResizablePanelGroup>
          </main>
        )}

        {follow.position ? (
          <WorkspaceFollowFrame
            position={follow.position}
            onStop={follow.stop}
          />
        ) : null}

        {/* Share Dialog */}
        <WorkspaceShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          workspaceId={workspaceId}
          workspaceName={activeWorkspace.name}
          currentUserRole={activeWorkspace.role}
          currentUserId={currentUserId}
          initialMembers={realtime.members}
          initialInvite={agent.requests.chat.shareInvite}
        />

        <SessionImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          workspaceId={workspaceId}
          onImported={(chatId, provider) => {
            recordChatProvider(chatId, provider);
            setActiveProvider(provider);
            setSelectedChatId(chatId);
            void refreshChats();
          }}
        />

        <WorkspaceSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onProvidersChanged={providersChanged}
        />

        <AlertDialog
          open={showProviderPicker}
          onOpenChange={setShowProviderPicker}
        >
          <AlertDialogContent className="gen2-workspace-surface">
            <AlertDialogHeader>
              <AlertDialogTitle>
                Which provider do you want to use?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Choose the AI provider for this chat.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {connectedChatProviders.map((provider) => (
                <AlertDialogAction
                  key={provider.id}
                  asChild
                  onClick={() => {
                    setShowProviderPicker(false);
                    void createChat(provider.id);
                  }}
                >
                  <WorkspaceButton tone="secondary" type="button">
                    <ProviderLogo provider={provider.id} size={16} />
                    {provider.name}
                  </WorkspaceButton>
                </AlertDialogAction>
              ))}
              <AlertDialogCancel asChild>
                <WorkspaceButton tone="ghost" type="button">
                  Cancel
                </WorkspaceButton>
              </AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Unsaved changes confirmation AlertDialog */}
        <AlertDialog
          open={showDiscardDialog}
          onOpenChange={setShowDiscardDialog}
        >
          <AlertDialogContent className="gen2-workspace-surface">
            <AlertDialogHeader>
              <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
              <AlertDialogDescription>
                You have unsaved changes on this branch. Switching worktrees
                will discard your unsaved editor changes. Are you sure you want
                to proceed?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={cancelDiscard}>
                Keep Editing
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDiscardAndSwitch}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Discard & Switch
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ShellProviders>
  );
}

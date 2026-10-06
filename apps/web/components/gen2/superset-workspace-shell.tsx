"use client";

import { workspaceStartupProgress } from "@/lib/gen2/startup-progress";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useWorkspaceConnection } from "./use-workspace-connection";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Kanban,
  LoaderCircle,
  Cloud,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  Pencil,
  Plus,
  SquareTerminal,
  UserPlus,
} from "lucide-react";
import type {
  Gen2AgentProviderName,
  Gen2Chat,
  Gen2WorkspaceDetail,
} from "@codev/contracts";
import { parseGitStatus } from "@/lib/runtime/ide";

import { WorkspaceButton } from "./workspace-button";
import { cn } from "@/lib/platform/utils";
import { WorkspaceShareDialog } from "./workspace-share-dialog";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Gen2ChatPanel } from "./chat-panel";
import { Gen2TerminalPane } from "./terminal-pane";
import { WorkspaceLoading } from "./workspace-loading";
import { WorkspaceSwitchDialog } from "./workspace-switch-dialog";
import {
  createSupersetWorktree,
  DEFAULT_SUPERSET_WORKTREE_ID,
  listSupersetWorktrees,
  SupersetFileApiError,
} from "./superset-file-client";
import { SupersetFilePane } from "./superset-file-pane";
import { SupersetChangesPane } from "./superset-changes-pane";
import {
  SupersetWorkspacesBoard,
  type BoardWorktreeItem,
} from "./superset-workspaces-board";
import { SupersetAgentSessionsPanel } from "./superset-agent-sessions-panel";
import {
  ProviderLogo,
  SUPPORTED_AI_PROVIDERS,
  type SupportedAiProvider,
} from "./provider-logos";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
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

type Tab = "files" | "changes" | "review";

type Worktree = { worktreeId: string; branch: string };

/** Auto-collapse the left rail below this viewport. User toggles pin the choice. */
export const GEN2_SIDEBAR_COLLAPSE_QUERY = "(max-width: 1279px)";
/** Auto-collapse the inspector below this viewport. User toggles pin the choice. */
export const GEN2_INSPECTOR_COLLAPSE_QUERY = "(max-width: 1023px)";

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

/**
 * The workspace you are already in. Branches are worktrees on this
 * workspace's machine, so people and agents can work without sharing a
 * checkout. The terminal is that machine. Files, changes, and review read
 * the selected branch.
 */
export function SupersetWorkspaceShell({
  workspace,
  workspaceId,
  canEdit,
  runtimeEnabled,
}: {
  workspace?: Gen2WorkspaceDetail | undefined;
  workspaceId: string;
  canEdit: boolean;
  runtimeEnabled: boolean;
}) {
  const [tab, setTab] = useState<Tab>("files");
  const [requestedFilePath, setRequestedFilePath] = useState<string | null>(
    null,
  );
  const [worktrees, setWorktrees] = useState<Worktree[]>([
    { worktreeId: DEFAULT_SUPERSET_WORKTREE_ID, branch: "main" },
  ]);
  const [worktreeId, setWorktreeId] = useState(DEFAULT_SUPERSET_WORKTREE_ID);
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false);
  const [pendingWorktreeId, setPendingWorktreeId] = useState<string | null>(
    null,
  );
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [terminalExpanded, setTerminalExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<"ide" | "board">("ide");
  const [shareOpen, setShareOpen] = useState(false);
  const [activeRuns, setActiveRuns] = useState<
    Array<{
      id: string;
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
  const [creating, setCreating] = useState(false);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newWorktreeId, setNewWorktreeId] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [baseRef, setBaseRef] = useState("");

  const [chats, setChats] = useState<Gen2Chat[]>([]);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
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
          },
        );
        if (!response.ok) return;
        const { chat } = (await response.json()) as { chat: Gen2Chat };
        setChats((prev) => [chat, ...prev]);
        setSelectedChatId(chat.id);
        setActiveProvider(provider);
        recordChatProvider(chat.id, provider);
      } catch {
        /* Ignore error */
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

  const boardItems: BoardWorktreeItem[] = worktrees.map((wt) => {
    const run = activeRuns.find((r) => r.worktreeId === wt.worktreeId);
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
      if (next.length) {
        setWorktrees(next);
        void refreshCounts(next);
      }
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

  async function createWorktree(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newWorktreeId.trim() || !newBranch.trim() || creating) return;
    setCreating(true);
    try {
      const created = await createSupersetWorktree(workspaceId, {
        worktreeId: newWorktreeId.trim(),
        branch: newBranch.trim(),
        ...(baseRef.trim() ? { baseRef: baseRef.trim() } : {}),
      });
      setWorktrees((current) => [...current, created]);
      setShowCreate(false);
      setNewWorktreeId("");
      setNewBranch("");
      setBaseRef("");
      const selected = selectWorktree(created.worktreeId);
      setNotice(
        selected
          ? `Created and selected ${created.branch}.`
          : `Created ${created.branch}. Your current unsaved changes were preserved.`,
      );
    } catch (error) {
      setNotice(errorMessage(error, "Couldn’t create this branch."));
    } finally {
      setCreating(false);
    }
  }

  const selected =
    worktrees.find((worktree) => worktree.worktreeId === worktreeId) ??
    worktrees[0];
  const selectedStatus = selected ? getBranchStatus(selected.worktreeId) : null;

  const activeChat =
    chats.find((chat) => chat.id === selectedChatId) ?? chats[0] ?? null;

  const connectedProviders = SUPPORTED_AI_PROVIDERS.filter(
    (p) => providerStatuses[p.id]?.connected,
  );

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
    <TooltipProvider delayDuration={300}>
      <div
        className="gen2-ide-container"
        data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
        data-inspector-collapsed={inspectorCollapsed ? "true" : "false"}
      >
        {/* Top navigation bar: quiet, unified, non-repeating context */}
        <header className="gen2-ide-top-navbar" aria-label="Top navigation">
          {/* Left section: sidebar toggle, brand badge, workspace & branch context grouped together */}
          <div className="gen2-ide-top-navbar-left">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/"
                  className="gen2-workspace-button gen2-ide-icon-button"
                  data-slot="button"
                  data-tone="ghost"
                  data-size="icon"
                  aria-label="Back to home"
                >
                  <ArrowLeft aria-hidden="true" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom">Home</TooltipContent>
            </Tooltip>

            <img
              className="gen2-brand-mark"
              src="/brand/codev-mark-v3.png"
              alt="CoDev"
              width={22}
              height={22}
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <WorkspaceButton
                  size="icon"
                  type="button"
                  className="gen2-ide-icon-button"
                  onClick={toggleSidebarByUser}
                  aria-label={
                    sidebarCollapsed ? "Expand sidebar" : "Minimize sidebar"
                  }
                >
                  {sidebarCollapsed ? (
                    <PanelLeft size={16} />
                  ) : (
                    <PanelLeftClose size={16} />
                  )}
                </WorkspaceButton>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {sidebarCollapsed ? "Expand sidebar" : "Minimize sidebar"}
              </TooltipContent>
            </Tooltip>

            {/* Grouped workspace and repository breadcrumb */}
            <div className="gen2-workspace-breadcrumb">
              <span className="gen2-workspace-breadcrumb-name">
                {activeWorkspace.name}
              </span>
              <span className="gen2-workspace-breadcrumb-sep">/</span>
              {activeWorkspace.repository ? (
                <>
                  <span className="gen2-workspace-breadcrumb-repo">
                    {activeWorkspace.repository.fullName}
                  </span>
                  <span className="gen2-workspace-breadcrumb-sep gen2-workspace-breadcrumb-repo">
                    /
                  </span>
                </>
              ) : null}
            </div>

            {/* Header Branch Dropdown: unified context with keyboard accessibility */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="gen2-topbar-branch-pill"
                  aria-label={`Active branch: ${selected?.branch ?? "main"}`}
                >
                  <GitBranch size={13} className="gen2-topbar-branch-icon" />
                  <span className="gen2-topbar-branch-name">
                    {selected?.branch ?? "main"}
                  </span>
                  {selectedStatus ? (
                    <span
                      className={cn(
                        "gen2-topbar-branch-status",
                        selectedStatus.tone,
                      )}
                    >
                      {selectedStatus.label}
                    </span>
                  ) : null}
                  <ChevronDown
                    size={11}
                    className="text-muted-foreground ml-0.5 shrink-0 opacity-70"
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-60 gen2-workspace-surface"
              >
                <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">
                  Switch branch
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {branchLoadError ? (
                  <DropdownMenuItem
                    onSelect={() => void refreshWorktrees()}
                    className="cursor-pointer py-1.5 px-2 text-xs text-muted-foreground"
                  >
                    Branch details unavailable · Retry
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuGroup>
                  {worktrees.map((wt) => {
                    const isSelected = wt.worktreeId === worktreeId;
                    const st = getBranchStatus(wt.worktreeId);
                    return (
                      <DropdownMenuItem
                        key={wt.worktreeId}
                        onClick={() => selectWorktree(wt.worktreeId)}
                        className="flex items-center justify-between cursor-pointer py-1.5 px-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <GitBranch
                            size={13}
                            className={cn(
                              "shrink-0",
                              isSelected
                                ? "text-primary font-medium"
                                : "text-muted-foreground",
                            )}
                          />
                          <span
                            className={cn(
                              "truncate font-mono",
                              isSelected && "font-semibold text-primary",
                            )}
                          >
                            {wt.branch}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          <span
                            className={cn("gen2-worktree-status-pill", st.tone)}
                          >
                            {st.label}
                          </span>
                          {isSelected ? (
                            <Check size={13} className="text-primary" />
                          ) : null}
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
                {canEdit ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        collapseSidebarByUser(false);
                        setShowCreate(true);
                      }}
                      className="cursor-pointer py-1.5 px-2 text-xs"
                    >
                      <Plus size={13} className="mr-2 shrink-0" />
                      <span>New branch…</span>
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Center section: quiet active session context, gracefully hides on narrow screens */}
          <div className="gen2-ide-top-navbar-center">
            <div className="gen2-topbar-session-card">
              {connectedProviders.some(
                (provider) => provider.id === activeProvider,
              ) ? (
                <div className="gen2-topbar-provider-avatar">
                  <ProviderLogo provider={activeProvider} size={14} />
                </div>
              ) : null}
              <span className="gen2-topbar-session-title">
                {activeChat?.title ?? "Initial Workspace Session"}
              </span>
              {agentRunning ? (
                <span className="gen2-topbar-session-status running">
                  <span
                    className="gen2-status-dot working"
                    aria-hidden="true"
                  />
                  Working…
                </span>
              ) : null}
            </div>
          </div>

          {/* Right section: share, board view toggle, truthful machine status, theme, inspector */}
          <div className="gen2-ide-top-navbar-right">
            <WorkspaceButton
              tone="secondary"
              onClick={() => setShareOpen(true)}
              aria-label="Share workspace"
            >
              <UserPlus data-icon="inline-start" aria-hidden="true" />
              <span className="gen2-topbar-action-label">Share</span>
            </WorkspaceButton>

            <WorkspaceButton
              tone="ghost"
              type="button"
              className={cn(
                "gen2-topbar-nav-button",
                viewMode === "board" && "active",
              )}
              aria-pressed={viewMode === "board"}
              onClick={() =>
                setViewMode((m) => (m === "board" ? "ide" : "board"))
              }
              aria-label={
                viewMode === "board" ? "Switch to IDE Stage" : "Switch to Board"
              }
            >
              <Kanban data-icon="inline-start" aria-hidden="true" />
              <span className="gen2-topbar-action-label">
                {viewMode === "board" ? "IDE Stage" : "Board"}
              </span>
            </WorkspaceButton>

            {connection.state === "connecting" ||
            connection.state === "checking" ? (
              <WorkspaceButton
                tone="secondary"
                size="toolbar"
                disabled
                aria-label={
                  connection.state === "connecting"
                    ? "Reconnecting workspace"
                    : "Checking workspace connection"
                }
              >
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin"
                  aria-hidden="true"
                />
                <span className="gen2-topbar-action-label">
                  {connection.state === "connecting"
                    ? "Reconnecting…"
                    : "Connecting…"}
                </span>
              </WorkspaceButton>
            ) : connection.state === "disconnected" && viewMode === "board" ? (
              <WorkspaceButton
                tone="secondary"
                size="toolbar"
                onClick={() => void ensureRunning()}
                aria-label="Reconnect workspace"
              >
                <Cloud data-icon="inline-start" aria-hidden="true" />
                <span className="gen2-topbar-action-label">Reconnect</span>
              </WorkspaceButton>
            ) : null}

            <Separator
              orientation="vertical"
              className="h-4 my-auto opacity-40"
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={`/gen2/${workspaceId}/second`}
                  className="gen2-workspace-button gen2-topbar-nav-button"
                  data-slot="button"
                  data-tone="ghost"
                  aria-label="Switch to classic view"
                >
                  <span className="gen2-topbar-action-label">Classic</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Switch to classic view
              </TooltipContent>
            </Tooltip>

            <ThemeToggle compact />

            {viewMode === "ide" ? (
              <>
                <Separator
                  orientation="vertical"
                  className="h-4 my-auto opacity-40"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <WorkspaceButton
                      size="icon"
                      type="button"
                      className={cn(
                        "gen2-ide-icon-button",
                        inspectorCollapsed && "active",
                      )}
                      onClick={toggleInspectorByUser}
                      aria-label={
                        inspectorCollapsed
                          ? "Expand inspector"
                          : "Collapse inspector"
                      }
                    >
                      <PanelRight size={16} />
                    </WorkspaceButton>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {inspectorCollapsed
                      ? "Expand inspector"
                      : "Collapse inspector"}
                  </TooltipContent>
                </Tooltip>
              </>
            ) : null}
          </div>
        </header>

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
                        aria-label={`Active worktree: ${selected?.branch ?? "main"}`}
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
                      {`Active worktree: ${selected?.branch ?? "main"} (${worktrees.length} branches)`}
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
                </div>
              ) : (
                <div className="gen2-sidebar-section">
                  <div className="gen2-sidebar-section-header">
                    <span className="gen2-sidebar-section-title">
                      ACTIVE WORKTREE
                    </span>
                    <span className="gen2-sidebar-section-count">
                      {worktrees.length}{" "}
                      {worktrees.length === 1 ? "BRANCH" : "BRANCHES"}
                    </span>
                  </div>
                  <div className="gen2-worktree-dropdown-wrapper">
                    <button
                      type="button"
                      className="gen2-worktree-trigger-btn"
                      onClick={() => setWorktreeDropdownOpen((open) => !open)}
                      aria-expanded={worktreeDropdownOpen}
                      aria-label={`Active worktree: ${selected?.branch ?? "main"}`}
                    >
                      <div className="gen2-worktree-trigger-left">
                        <GitBranch
                          size={14}
                          className="gen2-worktree-trigger-icon"
                        />
                        <span className="gen2-worktree-branch-name">
                          {selected?.branch ?? "main"}
                        </span>
                      </div>
                      <div className="gen2-worktree-trigger-right">
                        {selectedStatus ? (
                          <span
                            className={cn(
                              "gen2-worktree-status-pill",
                              selectedStatus.tone,
                            )}
                          >
                            {selectedStatus.label}
                          </span>
                        ) : null}
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
                          aria-label={`Active worktree: ${selected?.branch ?? "main"}`}
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
                        {`Active worktree: ${selected?.branch ?? "main"} (${worktrees.length} branches)`}
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
                                  {wt.branch}
                                </span>
                                <span
                                  className={cn(
                                    "gen2-worktree-status-pill",
                                    st.tone,
                                  )}
                                >
                                  {st.label}
                                </span>
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
                          {`${provider.name} (${chats.filter((c) => chatProviders[c.id] === provider.id || (connectedProviders.length === 1 && !chatProviders[c.id])).length} chats)`}
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
                      {/* Section 1: ACTIVE WORKTREE */}
                      <div className="gen2-sidebar-section">
                        <div className="gen2-sidebar-section-header">
                          <span className="gen2-sidebar-section-title">
                            ACTIVE WORKTREE
                          </span>
                          <span className="gen2-sidebar-section-count">
                            {worktrees.length}{" "}
                            {worktrees.length === 1 ? "BRANCH" : "BRANCHES"}
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
                            aria-label={`Active worktree: ${selected?.branch ?? "main"}`}
                          >
                            <div className="gen2-worktree-trigger-left">
                              <GitBranch
                                size={14}
                                className="gen2-worktree-trigger-icon"
                              />
                              <span className="gen2-worktree-branch-name">
                                {selected?.branch ?? "main"}
                              </span>
                            </div>
                            <div className="gen2-worktree-trigger-right">
                              {selectedStatus ? (
                                <span
                                  className={cn(
                                    "gen2-worktree-status-pill",
                                    selectedStatus.tone,
                                  )}
                                >
                                  {selectedStatus.label}
                                </span>
                              ) : null}
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
                                          {wt.branch}
                                        </span>
                                      </div>
                                      <div className="gen2-worktree-dropdown-item-right">
                                        <span
                                          className={cn(
                                            "gen2-worktree-status-pill",
                                            st.tone,
                                          )}
                                        >
                                          {st.label}
                                        </span>
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
                                  aria-label="New branch"
                                >
                                  <Plus size={13} />
                                  <span>New branch</span>
                                </WorkspaceButton>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {/* Inline creation form if showCreate is open */}
                        {showCreate ? (
                          <form
                            className="gen2-ide-branch-form"
                            onSubmit={(event) => void createWorktree(event)}
                          >
                            <label>
                              Worktree ID
                              <input
                                value={newWorktreeId}
                                onChange={(event) =>
                                  setNewWorktreeId(event.target.value)
                                }
                                placeholder="feature-auth"
                                required
                              />
                            </label>
                            <label>
                              Branch
                              <input
                                value={newBranch}
                                onChange={(event) =>
                                  setNewBranch(event.target.value)
                                }
                                placeholder="feature/auth"
                                required
                              />
                            </label>
                            <label>
                              Base ref <span>(optional)</span>
                              <input
                                value={baseRef}
                                onChange={(event) =>
                                  setBaseRef(event.target.value)
                                }
                                placeholder="main"
                              />
                            </label>
                            <div className="gen2-worktree-create-actions">
                              <WorkspaceButton
                                tone="primary"
                                type="submit"
                                disabled={creating}
                                className="gen2-worktree-form-submit-btn"
                              >
                                {creating ? "Creating…" : "Create worktree"}
                              </WorkspaceButton>
                              <WorkspaceButton
                                tone="ghost"
                                type="button"
                                onClick={() => setShowCreate(false)}
                                className="gen2-worktree-form-cancel-btn"
                              >
                                Cancel
                              </WorkspaceButton>
                            </div>
                          </form>
                        ) : null}
                      </div>

                      {/* Primary Action: + New Chat */}
                      <WorkspaceButton
                        tone="primary"
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

                      {/* Section 2: RECENT CHATS */}
                      <div className="gen2-sidebar-section gen2-sidebar-recent-chats">
                        <div className="gen2-sidebar-section-header">
                          <span className="gen2-sidebar-section-title">
                            RECENT CHATS
                          </span>
                          <span className="gen2-sidebar-section-count">
                            {chats.length}
                          </span>
                        </div>

                        {connectedProviders.length === 0 ? (
                          <div className="gen2-sidebar-no-providers">
                            <p className="text-xs text-muted-foreground">
                              Connect Codex or Claude to start a workspace chat.
                            </p>
                            <Link
                              href="/settings/personal/providers#coding-workspaces"
                              className="text-xs text-primary hover:underline mt-1 inline-block"
                            >
                              Connect in Settings
                            </Link>
                          </div>
                        ) : (
                          <div className="gen2-sidebar-providers-list">
                            {connectedProviders.map((provider) => {
                              const providerChats = chats.filter((c) => {
                                const mapped = chatProviders[c.id];
                                if (mapped) return mapped === provider.id;
                                if (connectedProviders.length === 1)
                                  return true;
                                return provider.id === activeProvider;
                              });

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
                                    <span className="gen2-sidebar-provider-count">
                                      {providerChats.length}
                                    </span>
                                  </div>

                                  {providerChats.length === 0 ? (
                                    <p className="gen2-sidebar-chat-empty">
                                      No {provider.name} chats yet
                                    </p>
                                  ) : (
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
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </aside>
                  </ResizablePanel>
                  <ResizableHandle withHandle className="gen2-ide-resizer" />
                </>
              ) : null}

              {/* Center Main Stage: Agent Chat & Docked Terminal */}
              <ResizablePanel
                minSize="240px"
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
                    canEdit={canEdit}
                    onSelect={setWorktreeId}
                    onStop={stopRun}
                    stoppingRunId={stoppingRunId}
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
                          void refreshWorktrees();
                        }}
                        onOpenFile={(path) => {
                          setRequestedFilePath(path);
                          setTab("files");
                        }}
                        onNeedsMachine={ensureRunning}
                      />
                    </div>
                    {connection.state === "connected" ? null : (
                      <>
                        <WorkspaceLoading
                          className="gen2-ide-loading"
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
                                    ? "An Individual plan is required"
                                    : connection.state === "disconnected"
                                      ? workspace?.status === "pending"
                                        ? "This workspace hasn't started"
                                        : "This workspace is asleep"
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

                  {/* Bottom terminal dock: click to expand / collapse */}
                  <div
                    className={cn(
                      "gen2-ide-terminal-dock",
                      terminalExpanded ? "expanded" : "collapsed",
                    )}
                    aria-label="Terminal dock"
                  >
                    <div
                      className="gen2-ide-terminal-dock-bar"
                      onClick={() =>
                        setTerminalExpanded((expanded) => !expanded)
                      }
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        setTerminalExpanded((expanded) => !expanded);
                      }}
                      role="button"
                      tabIndex={0}
                      aria-expanded={terminalExpanded}
                      aria-label={
                        terminalExpanded
                          ? "Collapse terminal"
                          : "Expand terminal"
                      }
                    >
                      <div className="gen2-ide-terminal-dock-label">
                        <SquareTerminal
                          aria-hidden="true"
                          className="gen2-ide-terminal-dock-icon"
                        />
                        <span className="gen2-ide-terminal-dock-title">
                          Terminal
                        </span>
                        <span className="gen2-ide-terminal-dock-badge">
                          {selected?.branch ?? "main"}
                        </span>
                      </div>
                      <div
                        className="gen2-ide-terminal-dock-action"
                        aria-hidden="true"
                      >
                        {terminalExpanded ? <ChevronDown /> : <ChevronUp />}
                      </div>
                    </div>

                    <div
                      className="gen2-ide-terminal-dock-content"
                      hidden={!terminalExpanded}
                    >
                      <Gen2TerminalPane
                        key={worktreeId}
                        workspaceId={workspaceId}
                        worktreeId={worktreeId}
                        visible={terminalExpanded}
                        canStart
                        autoStart
                        workspaceConnection={
                          connection.state === "connected"
                            ? "ready"
                            : connection.subscriptionRequired
                              ? "blocked"
                              : connection.state === "disconnected"
                                ? "asleep"
                                : "waking"
                        }
                        onResumeWorkspace={ensureRunning}
                        onExit={() => undefined}
                      />
                    </div>
                  </div>
                </section>
              </ResizablePanel>

              {/* Right Inspector: Files, Changes, Review */}
              {!inspectorCollapsed ? (
                <>
                  <ResizableHandle withHandle className="gen2-ide-resizer" />
                  <ResizablePanel
                    defaultSize="400px"
                    minSize="280px"
                    maxSize="480px"
                    groupResizeBehavior="preserve-pixel-size"
                    className="gen2-ide-inspector"
                  >
                    <aside
                      className="h-full w-full overflow-hidden flex flex-col"
                      aria-label="Branch files"
                    >
                      <div
                        role="tablist"
                        aria-label="Branch files"
                        className="gen2-ide-tabs"
                      >
                        {(
                          [
                            ["files", "Files"],
                            ["changes", "Changes"],
                            ["review", "Review"],
                          ] as const
                        ).map(([id, label]) => (
                          <button
                            key={id}
                            id={`superset-tab-${id}`}
                            type="button"
                            role="tab"
                            aria-selected={tab === id}
                            aria-controls={`superset-panel-${id}`}
                            onClick={() => setTab(id)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
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
                          requestedPath={requestedFilePath}
                          onRequestedPathConsumed={() =>
                            setRequestedFilePath(null)
                          }
                        />
                      </div>
                      <SupersetChangesPane
                        workspaceId={workspaceId}
                        worktreeId={worktreeId}
                        visible={tab === "changes"}
                        mode="changes"
                        onOpenFile={(path) => {
                          setRequestedFilePath(path);
                          setTab("files");
                        }}
                      />
                      <SupersetChangesPane
                        workspaceId={workspaceId}
                        worktreeId={worktreeId}
                        visible={tab === "review"}
                        mode="review"
                        onOpenFile={(path) => {
                          setRequestedFilePath(path);
                          setTab("files");
                        }}
                      />
                    </aside>
                  </ResizablePanel>
                </>
              ) : null}
            </ResizablePanelGroup>
          </main>
        )}

        {/* Share Dialog */}
        <WorkspaceShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          workspaceId={workspaceId}
          workspaceName={activeWorkspace.name}
          currentUserRole={activeWorkspace.role}
          initialMembers={activeWorkspace.members}
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
    </TooltipProvider>
  );
}

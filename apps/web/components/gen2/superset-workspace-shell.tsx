"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Kanban,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  Plus,
  RefreshCw,
  SquareTerminal,
} from "lucide-react";
import type { Gen2Chat, Gen2WorkspaceDetail } from "@codev/contracts";
import { parseGitStatus } from "@/lib/runtime/ide";
import { Badge } from "@/components/ui/badge";
import { ensureGen2WorkspaceReady } from "@/lib/gen2/startup-client";

import { Gen2ChatPanel } from "./chat-panel";
import { Gen2TerminalPane } from "./terminal-pane";
import {
  createSupersetWorktree,
  DEFAULT_SUPERSET_WORKTREE_ID,
  listSupersetWorktrees,
  SupersetFileApiError,
} from "./superset-file-client";
import { SupersetFilePane } from "./superset-file-pane";
import {
  SupersetWorkspacesBoard,
  type BoardWorktreeItem,
} from "./superset-workspaces-board";
import {
  ProviderLogo,
  SUPPORTED_AI_PROVIDERS,
  type SupportedAiProvider,
} from "./provider-logos";

type Tab = "files" | "changes" | "review";

type Worktree = { worktreeId: string; branch: string };

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
  return error instanceof SupersetFileApiError ? error.message : fallback;
}

function changedPaths(status: string) {
  return [...parseGitStatus(status)].map(([path, code]) => ({ path, code }));
}

function fileName(path: string) {
  return path.split("/").at(-1) ?? path;
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

function SupersetChangesPane({
  workspaceId,
  worktreeId,
  visible,
  mode,
}: {
  workspaceId: string;
  worktreeId: string;
  visible: boolean;
  mode: "changes" | "review";
}) {
  const [status, setStatus] = useState("");
  const [diff, setDiff] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextStatus, nextDiff] = await Promise.all([
        readGit(workspaceId, worktreeId, "status"),
        readGit(workspaceId, worktreeId, "diff").catch(() => ""),
      ]);
      setStatus(nextStatus);
      setDiff(nextDiff);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Couldn’t reach CoDev. Try refreshing Changes.",
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId, worktreeId]);

  useEffect(() => {
    // The request settles after the pane is shown and updates only its own copy.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (visible) void refresh();
  }, [visible, refresh]);

  const files = changedPaths(status);

  return (
    <section
      id={
        mode === "changes" ? "superset-panel-changes" : "superset-panel-review"
      }
      role="tabpanel"
      aria-labelledby={
        mode === "changes" ? "superset-tab-changes" : "superset-tab-review"
      }
      hidden={!visible}
      className="gen2-superset-tool-panel gen2-ide-panel"
    >
      <header className="gen2-ide-panel-bar">
        <p>
          {files.length
            ? `${files.length} changed file${files.length === 1 ? "" : "s"}`
            : "Working tree is clean"}
        </p>
        <button
          type="button"
          className="gen2-ide-icon-button"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label={mode === "review" ? "Refresh review" : "Refresh changes"}
        >
          <RefreshCw aria-hidden="true" size={15} />
        </button>
      </header>
      {error ? (
        <p className="gen2-superset-tool-error" role="alert">
          {error}
        </p>
      ) : null}
      {mode === "changes" && files.length ? (
        <ul className="gen2-superset-change-list" aria-label="Changed files">
          {files.map((file) => (
            <li key={file.path}>
              <code data-status={file.code}>{file.code}</code>
              <span>{file.path}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {mode === "review" && diff.trim() ? (
        <pre className="gen2-superset-diff" aria-label="Working tree diff">
          {diff}
        </pre>
      ) : null}
      {mode === "changes" && !files.length && !error ? (
        <p className="gen2-superset-tool-empty">
          Edit a file on this branch to see it here.
        </p>
      ) : null}
      {mode === "review" && !diff.trim() && !error ? (
        <p className="gen2-superset-tool-empty">
          {files.length
            ? "New files have no diff until Git tracks them."
            : "This branch has nothing to review yet."}
        </p>
      ) : null}
    </section>
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
  canEdit,
  runtimeEnabled,
}: {
  workspace?: Gen2WorkspaceDetail | undefined;
  workspaceId: string;
  canEdit: boolean;
  runtimeEnabled: boolean;
}) {
  const [tab, setTab] = useState<Tab>("files");
  const [worktrees, setWorktrees] = useState<Worktree[]>([
    { worktreeId: DEFAULT_SUPERSET_WORKTREE_ID, branch: "main" },
  ]);
  const [worktreeId, setWorktreeId] = useState(DEFAULT_SUPERSET_WORKTREE_ID);
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false);
  const [terminalExpanded, setTerminalExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<"ide" | "board">("ide");
  const [activeRuns, setActiveRuns] = useState<
    Array<{
      id: string;
      worktreeId: string;
      status: string;
      provider: string;
      lastError: string | null;
      updatedAt: string;
    }>
  >([]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newWorktreeId, setNewWorktreeId] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [baseRef, setBaseRef] = useState("");

  const [chats, setChats] = useState<Gen2Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] =
    useState<SupportedAiProvider>("codex");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [worktreeDropdownOpen, setWorktreeDropdownOpen] = useState(false);
  const worktreeDropdownRef = useRef<HTMLDivElement>(null);
  const [providerStatuses, setProviderStatuses] = useState<
    Record<SupportedAiProvider, { connected: boolean; via: string | null }>
  >({
    codex: { connected: false, via: null },
    claude: { connected: false, via: null },
    cursor: { connected: false, via: null },
  });

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
      const data = await res.json();
      setProviderStatuses({
        codex: data.codex ?? { connected: false, via: null },
        claude: data.claude ?? { connected: false, via: null },
        cursor: data.cursor ?? { connected: false, via: null },
      });
      if (!data[activeProvider]?.connected) {
        if (data.codex?.connected) setActiveProvider("codex");
        else if (data.claude?.connected) setActiveProvider("claude");
        else if (data.cursor?.connected) setActiveProvider("cursor");
      }
    } catch {
      /* Background check */
    }
  }, [activeProvider]);

  useEffect(() => {
    void refreshProviderStatuses();
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
    void refreshChats();
  }, [refreshChats]);

  const handleNewChat = useCallback(async () => {
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
      recordChatProvider(chat.id, activeProvider);
    } catch {
      /* Ignore error */
    }
  }, [workspaceId, activeProvider, recordChatProvider]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        worktreeDropdownRef.current &&
        !worktreeDropdownRef.current.contains(event.target as Node)
      ) {
        setWorktreeDropdownOpen(false);
      }
    }
    if (worktreeDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [worktreeDropdownOpen]);

  const activeWorkspace: Gen2WorkspaceDetail = workspace ?? {
    id: workspaceId,
    name: "Workspace",
    role: canEdit ? "editor" : "viewer",
    status: "ready",
    repository: null,
    sandboxId: null,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    members: [],
  };

  const [refreshToken, setRefreshToken] = useState(0);

  const ensureRunning = useCallback(async () => {
    setNotice("Connecting to workspace machine…");
    const result = await ensureGen2WorkspaceReady(workspaceId);
    if (result.workspace) {
      setNotice("");
      setRefreshToken((r) => r + 1);
      void refreshWorktrees();
      return true;
    }
    setNotice(result.error ?? "Failed to connect to workspace machine.");
    return false;
  }, [workspaceId]);

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

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  const boardItems: BoardWorktreeItem[] = worktrees.map((wt) => {
    const run = activeRuns.find((r) => r.worktreeId === wt.worktreeId);
    const count = fileCounts[wt.worktreeId] ?? 0;
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
    } else if (count > 0) {
      agentStatus = "review";
    }

    return {
      worktreeId: wt.worktreeId,
      branch: wt.branch,
      fileCount: count,
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
            // A missing count stays blank. "Clean" is only for a real status.
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
      setNotice("");
    } catch (error) {
      setNotice(errorMessage(error, "Couldn’t load branches."));
    }
  }, [refreshCounts, runtimeEnabled, workspaceId]);

  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void ensureRunning();
  }, [ensureRunning]);

  function selectWorktree(next: string) {
    if (next === worktreeId) return true;
    if (
      dirty &&
      !window.confirm("Discard unsaved changes and switch branches?")
    )
      return false;
    setWorktreeId(next);
    setDirty(false);
    setNotice("");
    return true;
  }

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
  const selectedCount = selected ? (fileCounts[selected.worktreeId] ?? 0) : 0;

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
        <SupersetFilePane workspaceId={workspaceId} canEdit={canEdit} />
      </>
    );
  }

  return (
    <div className="gen2-ide-container">
      {/* Top navigation bar spanning all three sections */}
      <header className="gen2-ide-top-navbar" aria-label="Top navigation">
        {/* Left section: sidebar toggle, brand badge, workspace breadcrumb, branch indicator */}
        <div className="gen2-ide-top-navbar-left">
          <button
            type="button"
            className="gen2-ide-icon-button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Minimize sidebar"
            }
            title={sidebarCollapsed ? "Expand sidebar" : "Minimize sidebar"}
          >
            <PanelLeft size={16} />
          </button>
          <div className="gen2-brand-badge" aria-hidden="true">
            C
          </div>
          <div className="gen2-workspace-breadcrumb">
            <span className="gen2-workspace-breadcrumb-name">
              {activeWorkspace.name}
            </span>
            <span className="gen2-workspace-breadcrumb-sep">/</span>
            <span className="gen2-workspace-breadcrumb-repo">
              {activeWorkspace.repository?.fullName ?? "repository"}
            </span>
          </div>
          <span className="gen2-topbar-divider" aria-hidden="true">
            |
          </span>
          <div className="gen2-topbar-branch-pill">
            <GitBranch size={13} className="text-blue-500 flex-shrink-0" />
            <span className="font-mono text-xs">
              {selected?.branch ?? "main"}
            </span>
            <span className="gen2-topbar-branch-status">
              {fileCounts[worktreeId] !== undefined
                ? fileCounts[worktreeId] === 0
                  ? "Clean"
                  : `${fileCounts[worktreeId]} changed`
                : "Active"}
            </span>
          </div>
        </div>

        {/* Center section: active session title with provider badge and live agent status */}
        <div className="gen2-ide-top-navbar-center">
          <div className="gen2-topbar-session-card">
            <div className="gen2-topbar-provider-avatar">
              <ProviderLogo provider={activeProvider} size={14} />
            </div>
            <span className="gen2-topbar-session-title">
              {activeChat?.title ?? "Initial Workspace Session"}
            </span>
            {agentRunning ? (
              <span className="gen2-topbar-session-status running">
                <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                Agent working…
              </span>
            ) : (
              <span className="gen2-topbar-session-status idle">
                {activeProvider.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* Right section: board toggle, machine status, quick inspector tabs, and inspector toggle */}
        <div className="gen2-ide-top-navbar-right">
          <button
            type="button"
            className={`gen2-topbar-nav-button ${viewMode === "board" ? "active" : ""}`}
            onClick={() =>
              setViewMode((m) => (m === "board" ? "ide" : "board"))
            }
            aria-label={
              viewMode === "board" ? "Switch to IDE Stage" : "Switch to Board"
            }
            title={
              viewMode === "board"
                ? "Switch to IDE Stage"
                : "Open Workspaces Board"
            }
          >
            <Kanban size={14} />
            <span>{viewMode === "board" ? "IDE Stage" : "Board"}</span>
          </button>

          <span className="gen2-topbar-divider" aria-hidden="true">
            |
          </span>

          <div className="gen2-topbar-status-pill" title="Workspace VM status">
            <span className="size-2 rounded-full bg-emerald-500" />
            <span className="text-xs text-muted-foreground font-mono">
              Machine: Online
            </span>
          </div>

          {viewMode === "ide" ? (
            <>
              <span className="gen2-topbar-divider" aria-hidden="true">
                |
              </span>

              <button
                type="button"
                className={`gen2-ide-icon-button ${inspectorCollapsed ? "active" : ""}`}
                onClick={() => setInspectorCollapsed((c) => !c)}
                aria-label={
                  inspectorCollapsed ? "Expand inspector" : "Collapse inspector"
                }
                title={
                  inspectorCollapsed ? "Expand inspector" : "Collapse inspector"
                }
              >
                <PanelRight size={16} />
              </button>
            </>
          ) : null}
        </div>
      </header>

      <main
        className={`gen2-ide ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${
          inspectorCollapsed ? "inspector-collapsed" : ""
        }`}
        data-view-mode={viewMode}
      >
        <aside
          className={`gen2-ide-branches ${sidebarCollapsed ? "collapsed" : ""}`}
          aria-label="Branches"
        >
          {sidebarCollapsed ? (
            <div className="gen2-sidebar-compact">
              {/* Worktree Trigger Dropdown */}
              <div
                className="gen2-worktree-dropdown-wrapper"
                ref={worktreeDropdownRef}
              >
                <button
                  type="button"
                  className="gen2-sidebar-compact-btn"
                  onClick={() => setWorktreeDropdownOpen((open) => !open)}
                  aria-expanded={worktreeDropdownOpen}
                  aria-label={`Active worktree: ${selected?.branch ?? "main"}`}
                  title={`Active worktree: ${selected?.branch ?? "main"} (${worktrees.length} branches)`}
                >
                  <GitBranch className="size-4 text-blue-500" />
                  {worktrees.length > 1 ? (
                    <span className="gen2-sidebar-compact-badge">
                      {worktrees.length}
                    </span>
                  ) : null}
                </button>

                {/* Floating Dropdown Menu */}
                <div
                  className={`gen2-worktree-dropdown-menu gen2-worktree-dropdown-menu-compact ${
                    worktreeDropdownOpen ? "open" : ""
                  }`}
                  role="menu"
                >
                  <div className="gen2-worktree-dropdown-header">
                    <span>Switch worktree</span>
                  </div>
                  <ul className="gen2-worktree-dropdown-list">
                    {worktrees.map((wt) => {
                      const isSelected = wt.worktreeId === worktreeId;
                      const count = fileCounts[wt.worktreeId] ?? 0;
                      return (
                        <li key={wt.worktreeId}>
                          <button
                            type="button"
                            className={`gen2-worktree-dropdown-item ${isSelected ? "selected" : ""}`}
                            onClick={() => {
                              selectWorktree(wt.worktreeId);
                              setWorktreeDropdownOpen(false);
                            }}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <GitBranch
                                className={`size-3.5 flex-shrink-0 ${
                                  isSelected
                                    ? "text-blue-500"
                                    : "text-muted-foreground"
                                }`}
                              />
                              <span className="font-mono text-xs truncate">
                                {wt.branch}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
                                {count ? `${count} files` : "Clean"}
                              </span>
                              {isSelected ? (
                                <Check size={13} className="text-blue-500" />
                              ) : null}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {canEdit ? (
                    <div className="gen2-worktree-dropdown-footer">
                      <button
                        type="button"
                        className="gen2-worktree-create-btn"
                        onClick={() => {
                          setSidebarCollapsed(false);
                          setShowCreate((current) => !current);
                          setWorktreeDropdownOpen(false);
                        }}
                        aria-label="New branch"
                      >
                        <Plus size={13} />
                        <span>New branch</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* New Chat Button */}
              <button
                type="button"
                className="gen2-sidebar-compact-btn primary"
                onClick={() => void handleNewChat()}
                aria-label="New Chat"
                title="New Chat"
              >
                <Plus size={16} strokeWidth={2.5} />
              </button>

              <div className="gen2-sidebar-compact-divider" />

              {/* Connected Providers */}
              <div className="gen2-sidebar-compact-providers">
                {connectedProviders.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    className={`gen2-sidebar-compact-btn provider ${
                      activeProvider === provider.id ? "active" : ""
                    }`}
                    onClick={() => setActiveProvider(provider.id)}
                    title={`${provider.name} (${chats.filter((c) => chatProviders[c.id] === provider.id || (connectedProviders.length === 1 && !chatProviders[c.id])).length} chats)`}
                    aria-label={`${provider.name} provider`}
                  >
                    <ProviderLogo provider={provider.id} size={16} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
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

                {/* Worktree Dropdown */}
                <div
                  className="gen2-worktree-dropdown-wrapper"
                  ref={worktreeDropdownRef}
                >
                  <button
                    type="button"
                    className="gen2-worktree-trigger-btn"
                    onClick={() => setWorktreeDropdownOpen((open) => !open)}
                    aria-expanded={worktreeDropdownOpen}
                    aria-label={`Active worktree: ${selected?.branch ?? "main"}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <GitBranch className="size-3.5 text-blue-400 flex-shrink-0" />
                      <span className="gen2-worktree-branch-name">
                        {selected?.branch ?? "main"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span
                        className={`gen2-worktree-status-pill ${
                          selectedCount > 0 ? "has-changes" : "clean"
                        }`}
                      >
                        {selectedCount > 0 ? `${selectedCount} files` : "Clean"}
                      </span>
                      <ChevronDown
                        className={`size-3.5 text-muted-foreground transition-transform duration-200 ${
                          worktreeDropdownOpen
                            ? "rotate-180 text-foreground"
                            : ""
                        }`}
                      />
                    </div>
                  </button>

                  {/* Dropdown Menu (rendered and toggled with open class) */}
                  <div
                    className={`gen2-worktree-dropdown-menu ${worktreeDropdownOpen ? "open" : ""}`}
                    role="menu"
                  >
                    <div className="gen2-worktree-dropdown-header">
                      <span>Switch worktree</span>
                    </div>
                    <ul className="gen2-worktree-dropdown-list">
                      {worktrees.map((wt) => {
                        const isSelected = wt.worktreeId === worktreeId;
                        const count = fileCounts[wt.worktreeId] ?? 0;
                        return (
                          <li key={wt.worktreeId}>
                            <button
                              type="button"
                              className={`gen2-worktree-dropdown-item ${isSelected ? "selected" : ""}`}
                              onClick={() => {
                                selectWorktree(wt.worktreeId);
                                setWorktreeDropdownOpen(false);
                              }}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <GitBranch
                                  className={`size-3.5 flex-shrink-0 ${
                                    isSelected
                                      ? "text-blue-500"
                                      : "text-muted-foreground"
                                  }`}
                                />
                                <span className="font-mono text-xs truncate">
                                  {wt.branch}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
                                  {count ? `${count} files` : "Clean"}
                                </span>
                                {isSelected ? (
                                  <Check size={13} className="text-blue-500" />
                                ) : null}
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {canEdit ? (
                      <div className="gen2-worktree-dropdown-footer">
                        <button
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
                        </button>
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
                        onChange={(event) => setNewBranch(event.target.value)}
                        placeholder="feature/auth"
                        required
                      />
                    </label>
                    <label>
                      Base ref <span>(optional)</span>
                      <input
                        value={baseRef}
                        onChange={(event) => setBaseRef(event.target.value)}
                        placeholder="main"
                      />
                    </label>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        type="submit"
                        disabled={creating}
                        className="flex-1 primary"
                      >
                        {creating ? "Creating…" : "Create worktree"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCreate(false)}
                        className="px-2 py-1 text-xs border rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : null}
              </div>

              {/* Primary Action: + New Chat */}
              <button
                type="button"
                className="gen2-sidebar-new-chat-btn"
                onClick={() => void handleNewChat()}
                aria-label="New Chat"
              >
                <div className="flex items-center gap-2">
                  <Plus size={14} strokeWidth={2.5} />
                  <span>New Chat</span>
                </div>
                <kbd className="gen2-sidebar-new-chat-kbd">⌘N</kbd>
              </button>

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
                      No AI providers connected.
                    </p>
                    <Link
                      href="/settings/personal/providers#coding-workspaces"
                      className="text-xs text-blue-500 hover:underline mt-1 inline-block"
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
                        if (connectedProviders.length === 1) return true;
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
                                size={14}
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
                                  chat.id === (selectedChatId ?? chats[0]?.id);
                                return (
                                  <li key={chat.id}>
                                    <button
                                      type="button"
                                      className={`gen2-sidebar-chat-card ${
                                        isSelected ? "selected" : ""
                                      }`}
                                      onClick={() => {
                                        setSelectedChatId(chat.id);
                                        setActiveProvider(provider.id);
                                      }}
                                    >
                                      <span className="gen2-sidebar-chat-title">
                                        {chat.title}
                                      </span>
                                      <div className="gen2-sidebar-chat-meta">
                                        <span>
                                          {chat.messageCount ?? 1} msgs
                                        </span>
                                        <span className="gen2-sidebar-chat-dot">
                                          •
                                        </span>
                                        <span>
                                          {formatRelativeTime(chat.updatedAt)}
                                        </span>
                                      </div>
                                    </button>
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
            </>
          )}
        </aside>

        {viewMode === "board" ? (
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
        ) : (
          <>
            <section
              className="gen2-ide-session"
              aria-label="Workspace session"
            >
              {notice ? (
                <p className="gen2-superset-runtime-notice" role="status">
                  {notice}
                </p>
              ) : null}

              {/* Middle part is ALWAYS the agent chat */}
              <div className="gen2-ide-chat-stage">
                <Gen2ChatPanel
                  workspace={activeWorkspace}
                  worktreeId={worktreeId}
                  activeChatId={selectedChatId}
                  onSelectChatId={setSelectedChatId}
                  onChatsChange={setChats}
                  activeProvider={activeProvider as any}
                  onActiveProviderChange={setActiveProvider as any}
                  hideChatBar={true}
                  onRunningChange={setAgentRunning}
                  onFilesChanged={() => {
                    void refreshWorktrees();
                  }}
                  onOpenFile={() => {
                    setTab("files");
                  }}
                  onNeedsMachine={ensureRunning}
                />
              </div>

              {/* Bottom terminal dock: click to expand / collapse */}
              <div
                className={`gen2-ide-terminal-dock ${terminalExpanded ? "expanded" : "collapsed"}`}
                aria-label="Terminal dock"
              >
                <div
                  className="gen2-ide-terminal-dock-bar"
                  onClick={() => setTerminalExpanded((expanded) => !expanded)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={terminalExpanded}
                  aria-label={
                    terminalExpanded ? "Collapse terminal" : "Expand terminal"
                  }
                >
                  <div className="flex items-center gap-2">
                    <SquareTerminal
                      aria-hidden="true"
                      size={14}
                      className="text-muted-foreground"
                    />
                    <span className="text-xs font-medium">Terminal</span>
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 h-4 font-mono text-muted-foreground"
                    >
                      {selected?.branch ?? "main"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="text-[11px]">
                      {terminalExpanded ? "Collapse" : "Expand"}
                    </span>
                    {terminalExpanded ? (
                      <ChevronDown aria-hidden="true" size={14} />
                    ) : (
                      <ChevronUp aria-hidden="true" size={14} />
                    )}
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
                    onResumeWorkspace={ensureRunning}
                    onExit={() => undefined}
                  />
                </div>
              </div>
            </section>

            <aside
              className={`gen2-ide-inspector ${inspectorCollapsed ? "collapsed" : ""}`}
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
                  worktreeId={worktreeId}
                  refreshToken={refreshToken}
                  onDirtyChange={setDirty}
                />
              </div>
              <SupersetChangesPane
                workspaceId={workspaceId}
                worktreeId={worktreeId}
                visible={tab === "changes"}
                mode="changes"
              />
              <SupersetChangesPane
                workspaceId={workspaceId}
                worktreeId={worktreeId}
                visible={tab === "review"}
                mode="review"
              />
            </aside>
          </>
        )}
      </main>
    </div>
  );
}

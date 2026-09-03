"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Grid2X2,
  List,
  LogOut,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";

import { RepositoryPicker } from "@/components/repository-picker";
import type { AppUser } from "@/lib/identity";

type WorkspaceItem = {
  id: string;
  repository: string;
  repositoryVisibility: string;
  defaultBranch: string;
  baseSha: string;
  status: string;
  role: string;
  updatedAt: string;
  liveCollaborators?: Array<{
    id: string;
    login: string;
    name: string | null;
    avatarUrl: string | null;
  }>;
};

type WorkspaceView = "grid" | "list";

const statuses = [
  "pending",
  "provisioning",
  "ready",
  "hibernated",
  "stopping",
  "stopped",
  "failed",
] as const;

const SCOPE_OPTIONS = [
  { value: "all", label: "All workspaces" },
  { value: "owner", label: "Owned by me" },
  { value: "member", label: "Shared with me" },
] as const;

type WorkspaceScope = (typeof SCOPE_OPTIONS)[number]["value"];

function formatUpdatedAt(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function collaboratorName(
  collaborator: NonNullable<WorkspaceItem["liveCollaborators"]>[number],
) {
  return collaborator.name || collaborator.login;
}

export function WorkspaceGrid({
  appSlug,
  githubAuthConfigured,
  user,
  workspaces,
}: {
  appSlug: string | undefined;
  githubAuthConfigured: boolean;
  user?: AppUser;
  workspaces: WorkspaceItem[];
}) {
  const [workspaceList, setWorkspaceList] = useState(workspaces);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [artifactType, setArtifactType] = useState("");
  const [view, setView] = useState<WorkspaceView>("grid");
  const [scope, setScope] = useState<WorkspaceScope>("all");
  const scopeMenuRef = useRef<HTMLDetailsElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    workspace: WorkspaceItem;
    mode: "delete" | "leave";
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const greeting = useMemo(() => getGreeting(), []);

  // Prewarm: nudge a workspace's Orca host awake on hover/focus intent so the
  // ~10s cold start overlaps navigation instead of starting only once the
  // workspace page has downloaded and hydrated. The wake is idempotent and
  // cheap (a DescribeInstances plus at most one StartInstances), fired once per
  // workspace per session, and its result is intentionally ignored — the
  // workspace page still runs the real connect.
  const prewarmedRef = useRef<Set<string>>(new Set());
  const hoverIntentRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const prewarmWorkspace = useCallback((workspaceId: string) => {
    if (prewarmedRef.current.has(workspaceId)) {
      return;
    }
    prewarmedRef.current.add(workspaceId);
    void fetch(`/api/workspaces/${workspaceId}/orca`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  }, []);
  const armPrewarm = useCallback(
    (workspaceId: string) => {
      const timer = setTimeout(() => prewarmWorkspace(workspaceId), 120);
      hoverIntentRef.current.set(workspaceId, timer);
    },
    [prewarmWorkspace],
  );
  const disarmPrewarm = useCallback((workspaceId: string) => {
    const timer = hoverIntentRef.current.get(workspaceId);
    if (timer) {
      clearTimeout(timer);
      hoverIntentRef.current.delete(workspaceId);
    }
  }, []);

  const sortedWorkspaces = useMemo(() => {
    return [...workspaceList].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [workspaceList]);

  const filteredWorkspaces = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sortedWorkspaces.filter((workspace) => {
      const matchesQuery =
        !normalizedQuery ||
        (workspace.repository || "Untitled workspace")
          .toLowerCase()
          .includes(normalizedQuery);
      const matchesStatus = !status || workspace.status === status;
      const matchesType =
        !artifactType ||
        (artifactType === "repository" && Boolean(workspace.repository)) ||
        (artifactType === "blank" && !workspace.repository);
      const matchesScope = scope === "all" || workspace.role === scope;
      return matchesQuery && matchesStatus && matchesType && matchesScope;
    });
  }, [artifactType, query, scope, sortedWorkspaces, status]);

  const activeCount = useMemo(() => {
    return workspaceList.filter(
      (w) => w.status === "ready" || w.status === "provisioning",
    ).length;
  }, [workspaceList]);

  const runPendingAction = async () => {
    if (!pendingAction) return;
    const { workspace, mode } = pendingAction;
    const failureMessage =
      mode === "leave"
        ? "Failed to leave workspace."
        : "Failed to delete workspace.";
    setBusyId(workspace.id);
    setActionError(null);
    try {
      const url =
        mode === "leave"
          ? `/api/workspaces/${workspace.id}/members/${user?.id ?? ""}`
          : `/api/workspaces/${workspace.id}`;
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok) {
        setWorkspaceList((prev) => prev.filter((w) => w.id !== workspace.id));
        setPendingAction(null);
      } else {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setActionError(data?.error || failureMessage);
      }
    } catch {
      setActionError(failureMessage);
    } finally {
      setBusyId(null);
    }
  };

  const firstName =
    user?.name?.split(" ")[0] || user?.githubLogin || "Developer";

  const scopeLabel =
    SCOPE_OPTIONS.find((option) => option.value === scope)?.label ??
    "All workspaces";

  return (
    <div className="home-hub-shell">
      {/* Home Hero Greeting Banner */}
      <section className="home-welcome-hero">
        <div className="home-welcome-header">
          <div className="home-welcome-text">
            <span className="home-badge">Workspace Home</span>
            <h1>
              {greeting},{" "}
              <span className="home-highlight-name">{firstName}</span>
            </h1>
            <p>Build together with people and AI agents.</p>
          </div>

          <div className="home-quick-stats">
            <div className="stat-card">
              <span className="stat-label">Workspaces</span>
              <strong className="stat-value">{workspaceList.length}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Active / Provisioning</span>
              <strong className="stat-value stat-value-active">
                {activeCount}
              </strong>
            </div>
            {user?.githubLogin ? (
              <div className="stat-card">
                <span className="stat-label">Connected GitHub</span>
                <strong className="stat-value">@{user.githubLogin}</strong>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Main Workspace Browser Section */}
      <section className="workspace-browser" aria-label="Workspace browser">
        <div className="home-section-header">
          <div>
            <h2>Your Workspaces</h2>
            <p>Access and manage all your active repository workspaces.</p>
          </div>
        </div>

        <div className="workspace-toolbar">
          <label className="workspace-search">
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search workspaces..."
              aria-label="Search workspaces"
            />
          </label>
          <label className="workspace-filter">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              aria-label="Filter by status"
            >
              <option value="">Any status</option>
              {statuses.map((option) => (
                <option value={option} key={option}>
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="workspace-filter">
            <select
              value={artifactType}
              onChange={(event) => setArtifactType(event.target.value)}
              aria-label="Filter by type"
            >
              <option value="">Any type</option>
              <option value="repository">GitHub repository</option>
              <option value="blank">Blank workspace</option>
            </select>
          </label>
        </div>

        <div className="workspace-grid-heading">
          <span>
            {filteredWorkspaces.length}{" "}
            {filteredWorkspaces.length === 1 ? "workspace" : "workspaces"}
          </span>
          <div className="workspace-view-controls">
            <details className="workspace-scope-menu" ref={scopeMenuRef}>
              <summary className="workspace-scope">
                <SlidersHorizontal aria-hidden="true" />
                {scopeLabel}
                <ChevronDown aria-hidden="true" />
              </summary>
              <div className="workspace-scope-popover" role="menu">
                {SCOPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={scope === option.value}
                    className="workspace-scope-option"
                    onClick={() => {
                      setScope(option.value);
                      scopeMenuRef.current?.removeAttribute("open");
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </details>
            <div className="workspace-view-toggle" aria-label="Workspace view">
              <button
                className={view === "grid" ? "is-active" : ""}
                type="button"
                aria-label="Grid view"
                aria-pressed={view === "grid"}
                onClick={() => setView("grid")}
              >
                <Grid2X2 aria-hidden="true" />
              </button>
              <button
                className={view === "list" ? "is-active" : ""}
                type="button"
                aria-label="List view"
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
              >
                <List aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div
          className={`workspace-cards ${view === "list" ? "workspace-cards-list" : ""}`}
        >
          <RepositoryPicker
            appSlug={appSlug}
            githubAuthConfigured={githubAuthConfigured}
            githubConnected={Boolean(user?.githubLogin)}
          />
          {filteredWorkspaces.map((workspace) => (
            <div
              className="workspace-card-wrapper"
              key={workspace.id}
              style={{ position: "relative" }}
            >
              <Link
                href={`/workspaces/${workspace.id}`}
                className="workspace-card-link"
                aria-label={`Open ${workspace.repository || "workspace"}`}
                style={{ textDecoration: "none", color: "inherit" }}
                onPointerEnter={() => armPrewarm(workspace.id)}
                onPointerLeave={() => disarmPrewarm(workspace.id)}
                onFocus={() => prewarmWorkspace(workspace.id)}
                onPointerDown={() => prewarmWorkspace(workspace.id)}
              >
                <article className="workspace-card">
                  <div
                    className="workspace-card-presence"
                    aria-label={
                      workspace.liveCollaborators?.length
                        ? `${workspace.liveCollaborators.length} collaborator${workspace.liveCollaborators.length === 1 ? "" : "s"} live now`
                        : "No collaborators live now"
                    }
                  >
                    <span className="workspace-card-presence-label">
                      In this workspace
                    </span>
                    {workspace.liveCollaborators?.length ? (
                      <div className="workspace-live-collaborators">
                        {workspace.liveCollaborators.map((collaborator) =>
                          collaborator.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- Presence avatars can originate from a member's identity provider, so they cannot use a fixed Next image allowlist.
                            <img
                              key={collaborator.id}
                              src={collaborator.avatarUrl}
                              alt={collaboratorName(collaborator)}
                              title={`${collaboratorName(collaborator)} is active now`}
                            />
                          ) : (
                            <span
                              key={collaborator.id}
                              aria-label={`${collaboratorName(collaborator)} is active now`}
                              title={`${collaboratorName(collaborator)} is active now`}
                            >
                              {collaboratorName(collaborator).slice(0, 1)}
                            </span>
                          ),
                        )}
                        <small>Live now</small>
                      </div>
                    ) : (
                      <p className="workspace-card-presence-empty">
                        No one is active right now
                      </p>
                    )}
                  </div>
                  <div>
                    <strong>
                      {workspace.repository || "Untitled workspace"}
                    </strong>
                    <span>
                      {workspace.repository
                        ? `${workspace.defaultBranch || "No branch"} · ${workspace.baseSha.slice(0, 7)}`
                        : "No repository connected"}
                    </span>
                  </div>
                  <div className="workspace-card-meta">
                    <span className="workspace-card-access">
                      {workspace.repositoryVisibility === "private"
                        ? "Private"
                        : workspace.repository
                          ? "Public"
                          : "Blank"}
                    </span>
                    <small>{formatUpdatedAt(workspace.updatedAt)}</small>
                  </div>
                </article>
              </Link>
              {(() => {
                const mode =
                  workspace.role === "owner"
                    ? ("delete" as const)
                    : ("leave" as const);
                const label = `${mode === "leave" ? "Leave" : "Delete"} ${
                  workspace.repository || "workspace"
                }`;
                return (
                  <button
                    type="button"
                    className="workspace-card-action-button"
                    aria-label={label}
                    title={
                      mode === "leave" ? "Leave workspace" : "Delete workspace"
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPendingAction({ workspace, mode });
                    }}
                    style={{
                      position: "absolute",
                      top: "12px",
                      right: "12px",
                      zIndex: 10,
                      background: "transparent",
                      border: "none",
                      padding: "8px",
                      borderRadius: "6px",
                      color: "var(--workspace-faint, #888)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {mode === "leave" ? (
                      <LogOut className="h-4 w-4" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                );
              })()}
            </div>
          ))}
        </div>

        {!filteredWorkspaces.length && sortedWorkspaces.length ? (
          <p className="workspace-empty-state">
            No workspaces match these filters.
          </p>
        ) : null}

        {pendingAction
          ? (() => {
              const { workspace, mode } = pendingAction;
              const busy = busyId === workspace.id;
              const name = workspace.repository || "this workspace";
              const isLeave = mode === "leave";
              const title = isLeave ? "Leave workspace?" : "Delete workspace?";
              const cancel = () => {
                if (!busy) {
                  setPendingAction(null);
                  setActionError(null);
                }
              };
              return (
                <div
                  className="delete-workspace-backdrop"
                  style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 1000,
                    background: "rgba(0, 0, 0, 0.6)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  onClick={cancel}
                >
                  <div
                    className="delete-workspace-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="workspace-action-title"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancel();
                    }}
                    style={{
                      background: "var(--workspace-surface, #1e1e1e)",
                      color: "var(--workspace-ink, #fff)",
                      border: "1px solid var(--workspace-line, #333)",
                      borderRadius: "12px",
                      padding: "24px",
                      maxWidth: "420px",
                      width: "90%",
                      boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3
                      id="workspace-action-title"
                      style={{
                        margin: "0 0 8px",
                        fontSize: "16px",
                        fontWeight: 700,
                      }}
                    >
                      {title}
                    </h3>
                    <p
                      style={{
                        margin: "0 0 16px",
                        fontSize: "13px",
                        opacity: 0.8,
                        lineHeight: 1.5,
                      }}
                    >
                      {isLeave ? (
                        <>
                          You&rsquo;ll lose access to <strong>{name}</strong>{" "}
                          until someone invites you back. The workspace and
                          everyone else&rsquo;s access stay untouched.
                        </>
                      ) : (
                        <>
                          Are you sure you want to delete{" "}
                          <strong>{name}</strong>? This action is permanent and
                          cannot be undone.
                        </>
                      )}
                    </p>
                    {actionError ? (
                      <div
                        style={{
                          color: "#d66161",
                          fontSize: "12px",
                          marginBottom: "12px",
                        }}
                      >
                        {actionError}
                      </div>
                    ) : null}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: "10px",
                      }}
                    >
                      <button
                        type="button"
                        autoFocus
                        disabled={busy}
                        onClick={cancel}
                        style={{
                          background: "transparent",
                          border: "1px solid var(--workspace-line, #444)",
                          color: "inherit",
                          borderRadius: "6px",
                          padding: "8px 14px",
                          fontSize: "13px",
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runPendingAction()}
                        style={{
                          background: isLeave ? "#8a5a2b" : "#b33f3f",
                          color: "#fff",
                          border: "none",
                          borderRadius: "6px",
                          padding: "8px 14px",
                          fontSize: "13px",
                          fontWeight: 600,
                          cursor: "pointer",
                          opacity: busy ? 0.6 : 1,
                        }}
                      >
                        {busy
                          ? isLeave
                            ? "Leaving..."
                            : "Deleting..."
                          : isLeave
                            ? "Leave workspace"
                            : "Delete workspace"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()
          : null}
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  FolderGit2,
  Grid2X2,
  List,
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

export function WorkspaceGrid({
  appSlug,
  user,
  workspaces,
}: {
  appSlug: string | undefined;
  user?: AppUser;
  workspaces: WorkspaceItem[];
}) {
  const [workspaceList, setWorkspaceList] = useState(workspaces);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [artifactType, setArtifactType] = useState("");
  const [view, setView] = useState<WorkspaceView>("grid");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmWorkspace, setDeleteConfirmWorkspace] =
    useState<WorkspaceItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const greeting = useMemo(() => getGreeting(), []);

  const sortedWorkspaces = useMemo(() => {
    return [...workspaceList].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [workspaceList]);

  const latestWorkspace = sortedWorkspaces[0];

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
      return matchesQuery && matchesStatus && matchesType;
    });
  }, [artifactType, query, sortedWorkspaces, status]);

  const activeCount = useMemo(() => {
    return workspaceList.filter(
      (w) => w.status === "ready" || w.status === "provisioning",
    ).length;
  }, [workspaceList]);

  const handleDeleteWorkspace = async (workspaceId: string) => {
    setDeletingId(workspaceId);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setWorkspaceList((prev) => prev.filter((w) => w.id !== workspaceId));
        setDeleteConfirmWorkspace(null);
      } else {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setDeleteError(data?.error || "Failed to delete workspace.");
      }
    } catch {
      setDeleteError("Failed to delete workspace.");
    } finally {
      setDeletingId(null);
    }
  };

  const firstName =
    user?.name?.split(" ")[0] || user?.githubLogin || "Developer";

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
            <p>
              Welcome back to CoDev. Pick up right where you left off or start a
              new collaborative workspace with AI agents.
            </p>
          </div>

          <div className="home-quick-stats">
            <div className="stat-card">
              <span className="stat-label">Workspaces</span>
              <strong className="stat-value">{workspaces.length}</strong>
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

        {/* Quick Resume Hero Card */}
        {latestWorkspace ? (
          <div className="home-quick-resume-card">
            <div className="resume-card-badge">
              <span>Quick Resume</span>
              <span className="resume-card-time">
                Active {formatUpdatedAt(latestWorkspace.updatedAt)}
              </span>
            </div>

            <div className="resume-card-content">
              <div className="resume-card-info">
                <h2>{latestWorkspace.repository || "Untitled workspace"}</h2>
                <div className="resume-card-meta">
                  <span className="meta-pill">
                    <FolderGit2 className="h-3.5 w-3.5" />
                    {latestWorkspace.defaultBranch || "main"}
                  </span>
                  {latestWorkspace.baseSha ? (
                    <span className="meta-pill font-mono">
                      {latestWorkspace.baseSha.slice(0, 7)}
                    </span>
                  ) : null}
                  <span
                    className={`status-pill status-${latestWorkspace.status}`}
                  >
                    {latestWorkspace.status}
                  </span>
                </div>
              </div>

              <Link
                className="resume-primary-button"
                href={`/workspaces/${latestWorkspace.id}/ide`}
              >
                <span>Resume Session</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        ) : null}
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
            <button className="workspace-scope" type="button">
              <SlidersHorizontal aria-hidden="true" />
              All workspaces
              <ChevronDown aria-hidden="true" />
            </button>
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
          <RepositoryPicker appSlug={appSlug} />
          {filteredWorkspaces.map((workspace) => (
            <div
              className="workspace-card-wrapper"
              key={workspace.id}
              style={{ position: "relative" }}
            >
              <Link
                className="workspace-card"
                href={`/workspaces/${workspace.id}/ide`}
              >
                <span className="workspace-card-icon" aria-hidden="true" />
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
              </Link>
              <button
                type="button"
                className="workspace-card-delete-button"
                aria-label={`Delete ${workspace.repository || "workspace"}`}
                title="Delete workspace"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDeleteConfirmWorkspace(workspace);
                }}
                style={{
                  position: "absolute",
                  top: "12px",
                  right: "12px",
                  zIndex: 10,
                  background: "transparent",
                  border: "none",
                  padding: "6px",
                  borderRadius: "6px",
                  color: "var(--workspace-faint, #888)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        {!filteredWorkspaces.length && sortedWorkspaces.length ? (
          <p className="workspace-empty-state">
            No workspaces match these filters.
          </p>
        ) : null}

        {deleteConfirmWorkspace ? (
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
            onClick={() => setDeleteConfirmWorkspace(null)}
          >
            <div
              className="delete-workspace-modal"
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
                style={{ margin: "0 0 8px", fontSize: "16px", fontWeight: 700 }}
              >
                Delete Workspace?
              </h3>
              <p
                style={{
                  margin: "0 0 16px",
                  fontSize: "13px",
                  opacity: 0.8,
                  lineHeight: 1.5,
                }}
              >
                Are you sure you want to delete{" "}
                <strong>
                  {deleteConfirmWorkspace.repository || "this workspace"}
                </strong>
                ? This action is permanent and cannot be undone.
              </p>
              {deleteError ? (
                <div
                  style={{
                    color: "#d66161",
                    fontSize: "12px",
                    marginBottom: "12px",
                  }}
                >
                  {deleteError}
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
                  disabled={deletingId === deleteConfirmWorkspace.id}
                  onClick={() => setDeleteConfirmWorkspace(null)}
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
                  disabled={deletingId === deleteConfirmWorkspace.id}
                  onClick={() =>
                    void handleDeleteWorkspace(deleteConfirmWorkspace.id)
                  }
                  style={{
                    background: "#b33f3f",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "8px 14px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    opacity: deletingId === deleteConfirmWorkspace.id ? 0.6 : 1,
                  }}
                >
                  {deletingId === deleteConfirmWorkspace.id
                    ? "Deleting..."
                    : "Delete Workspace"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

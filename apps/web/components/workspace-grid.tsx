"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ChevronDown,
  Grid2X2,
  List,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { RepositoryPicker } from "@/components/repository-picker";

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

export function WorkspaceGrid({
  appSlug,
  workspaces,
}: {
  appSlug: string | undefined;
  workspaces: WorkspaceItem[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [artifactType, setArtifactType] = useState("");
  const [view, setView] = useState<WorkspaceView>("grid");

  const filteredWorkspaces = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return workspaces.filter((workspace) => {
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
  }, [artifactType, query, status, workspaces]);

  return (
    <section className="workspace-browser" aria-label="Workspace browser">
      <div className="workspace-toolbar">
        <label className="workspace-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
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
          <Link
            className="workspace-card"
            href={`/workspaces/${workspace.id}/ide`}
            key={workspace.id}
          >
            <span className="workspace-card-icon" aria-hidden="true" />
            <div>
              <strong>{workspace.repository || "Untitled workspace"}</strong>
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
        ))}
      </div>

      {!filteredWorkspaces.length && workspaces.length ? (
        <p className="workspace-empty-state">
          No workspaces match these filters.
        </p>
      ) : null}
    </section>
  );
}

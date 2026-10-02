"use client";

import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, List, Search } from "lucide-react";
import type { Gen2Workspace } from "@codev/contracts";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SubscribeCallout } from "@/components/billing/subscribe-callout";
import { CreateGen2WorkspaceForm } from "@/components/gen2/create-workspace-form";
import { Gen2WorkspaceList } from "@/components/gen2/workspace-list";
import type { AppUser } from "@/lib/auth/identity";

type DashboardProps = {
  user: AppUser;
  github: { connected: boolean; login: string | null };
  initialWorkspaces: Gen2Workspace[];
  appSlug?: string | undefined;
  connectGitHub?: (() => void) | undefined;
  billing?: {
    hasAccess: boolean;
    pastDue?: boolean;
    priceUsdPerMonth: number;
  };
};

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

export function Gen2WorkspaceDashboard({
  user,
  github,
  initialWorkspaces,
  appSlug,
  connectGitHub,
  billing,
}: DashboardProps) {
  const canCreate = billing?.hasAccess !== false;
  const [workspaces, setWorkspaces] =
    useState<Gen2Workspace[]>(initialWorkspaces);
  const [greeting, setGreeting] = useState("Good evening");
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "owned" | "shared">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useEffect(() => {
    // The greeting depends on the visitor's clock, so it is set after mount to
    // keep the server and first client render identical.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGreeting(getGreeting());
  }, []);

  useEffect(() => {
    // Pick up a refreshed list from the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorkspaces(initialWorkspaces);
  }, [initialWorkspaces]);

  const activeCount = useMemo(() => {
    return workspaces.filter(
      (w) => w.status === "ready" || w.status === "provisioning",
    ).length;
  }, [workspaces]);

  const ownedCount = useMemo(() => {
    return workspaces.filter((w) => w.role === "owner").length;
  }, [workspaces]);

  const displayName = useMemo(() => {
    const raw =
      user.name?.trim().split(/\s+/)[0] ||
      github.login ||
      user.email?.split("@")[0] ||
      "there";
    return raw.toLowerCase();
  }, [user.name, user.email, github.login]);

  const githubHandle = github.login || user.githubLogin || null;

  return (
    <div className="gen2-home-dashboard">
      <header className="gen2-home-header">
        <div className="gen2-home-header-left">
          <p className="gen2-home-eyebrow">WORKSPACE HOME</p>
          <h1 className="gen2-home-title">
            {greeting}, {displayName}
          </h1>
          <p className="gen2-home-subtitle">
            Build together with people and AI agents.
          </p>
        </div>

        <div className="gen2-stats-row">
          <div className="gen2-stat-card">
            <span className="gen2-stat-value">{workspaces.length}</span>
            <span className="gen2-stat-label">Workspaces</span>
          </div>

          <div className="gen2-stat-card">
            <span className="gen2-stat-value">{activeCount}</span>
            <span className="gen2-stat-label">Active</span>
          </div>

          <div className="gen2-stat-card">
            {githubHandle ? (
              <span className="gen2-stat-value is-handle">@{githubHandle}</span>
            ) : github.connected ? (
              <span className="gen2-stat-value is-handle">Connected</span>
            ) : connectGitHub ? (
              <form action={connectGitHub}>
                <button type="submit" className="gen2-stat-connect-btn">
                  Connect
                </button>
              </form>
            ) : (
              <span className="gen2-stat-value is-handle">Not connected</span>
            )}
            <span className="gen2-stat-label">GitHub</span>
          </div>
        </div>
      </header>

      {billing && !billing.hasAccess ? (
        <SubscribeCallout
          pastDue={billing.pastDue ?? false}
          priceUsdPerMonth={billing.priceUsdPerMonth}
        />
      ) : null}

      <div className="gen2-toolbar">
        <div className="gen2-toolbar-left">
          <label className="gen2-search-box">
            <Search className="gen2-search-icon" size={15} aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search workspaces..."
              aria-label="Search workspaces"
              autoComplete="off"
            />
          </label>

          <div
            className="gen2-filters"
            role="tablist"
            aria-label="Filter workspaces"
          >
            {(["all", "owned", "shared"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={filter === tab}
                className={`gen2-filter-pill ${filter === tab ? "is-active" : ""}`}
                onClick={() => setFilter(tab)}
              >
                {tab === "all" ? "All" : tab === "owned" ? "Owned" : "Shared"}
              </button>
            ))}
          </div>
        </div>

        <div className="gen2-toolbar-right">
          <div
            className="gen2-view-switcher"
            role="group"
            aria-label="View mode"
          >
            <button
              type="button"
              className={`gen2-view-btn ${viewMode === "grid" ? "is-active" : ""}`}
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              className={`gen2-view-btn ${viewMode === "list" ? "is-active" : ""}`}
              aria-label="List view"
              aria-pressed={viewMode === "list"}
              onClick={() => setViewMode("list")}
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      <Gen2WorkspaceList
        workspaces={workspaces}
        viewMode={viewMode}
        searchQuery={searchQuery}
        filter={filter}
        showCreateCard={canCreate && viewMode === "grid" && filter !== "shared"}
        onCreateWorkspace={() => {
          if (canCreate) setIsCreateOpen(true);
        }}
        onWorkspacesChange={setWorkspaces}
      />

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              Start a blank workspace or import a GitHub repository into an
              isolated Firecracker instance.
            </DialogDescription>
          </DialogHeader>
          <CreateGen2WorkspaceForm
            githubConnected={github.connected}
            ownedWorkspaceCount={ownedCount}
            appSlug={appSlug}
            connectGitHub={connectGitHub}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

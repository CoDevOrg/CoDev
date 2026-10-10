"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import type { Gen2HomeSnapshot, Gen2Workspace } from "@codev/contracts";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SubscribeCallout } from "@/components/billing/subscribe-callout";
import { GithubMark } from "@/components/settings/github-mark";
import { CreateGen2WorkspaceForm } from "@/components/gen2/create-workspace-form";
import { useGen2HomeSnapshot } from "@/components/gen2/use-gen2-home-snapshot";
import { WorkspaceComputeAlerts } from "@/components/gen2/workspace-compute-stats";
import { WorkspaceHomeStats } from "@/components/gen2/workspace-home-stats";
import { WorkspaceHomeToolbar } from "@/components/gen2/workspace-home-toolbar";
import {
  Gen2WorkspaceList,
  type WorkspaceFilter,
} from "@/components/gen2/workspace-list";

type DashboardProps = {
  /** Only what the page renders; never the whole session user. */
  user: { name?: string | null };
  github: { connected: boolean; login: string | null };
  initialSnapshot: Gen2HomeSnapshot;
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

const noSubscription = () => () => {};

function GitHubStatus({
  github,
  connectGitHub,
}: Pick<DashboardProps, "github" | "connectGitHub">) {
  if (github.connected) {
    return (
      <Link className="gen2-github-chip" href="/settings/personal/integrations">
        <GithubMark className="size-4" />
        {github.login ? `@${github.login}` : "GitHub connected"}
      </Link>
    );
  }
  if (!connectGitHub) return null;
  return (
    <form action={connectGitHub}>
      <Button type="submit" variant="outline">
        <GithubMark className="size-4" /> Connect GitHub
      </Button>
    </form>
  );
}

/** The signed-in member's workspace home: live stats, cards, and create. */
export function Gen2WorkspaceDashboard({
  user,
  github,
  initialSnapshot,
  appSlug,
  connectGitHub,
  billing,
}: DashboardProps) {
  const { snapshot, refresh, update } = useGen2HomeSnapshot(initialSnapshot);
  const { workspaces, compute } = snapshot;
  const greeting = useSyncExternalStore(
    noSubscription,
    getGreeting,
    () => "Good evening",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<WorkspaceFilter>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const isFreeEligible = compute.tier === "free" && compute.freeEnabled;
  const hasPlan = billing?.hasAccess !== false || isFreeEligible;
  const ownedCount = compute.ownedWorkspaceCount;
  const canCreate = hasPlan && ownedCount < compute.workspaceLimit;
  const counts = useMemo(() => {
    const owned = workspaces.filter((item) => item.role === "owner").length;
    return { all: workspaces.length, owned, shared: workspaces.length - owned };
  }, [workspaces]);
  const firstName = user.name?.trim().split(/\s+/)[0] || github.login || null;

  function deleted(workspace: Gen2Workspace, accepted: boolean) {
    update((current) => ({
      ...current,
      workspaces: accepted
        ? current.workspaces.map((item) =>
            item.id === workspace.id
              ? { ...item, status: "deleting", lastError: null }
              : item,
          )
        : current.workspaces.filter((item) => item.id !== workspace.id),
    }));
    void refresh();
  }

  return (
    <div className="gen2-home-dashboard">
      <header className="gen2-home-header">
        <div className="gen2-home-heading">
          <p className="gen2-home-eyebrow">Workspace home</p>
          <h1 className="gen2-home-title">
            {firstName ? `${greeting}, ${firstName}` : greeting}
          </h1>
          <p className="gen2-home-subtitle">
            Build together with people and AI agents.
          </p>
        </div>
        <div className="gen2-home-actions">
          <GitHubStatus github={github} connectGitHub={connectGitHub} />
          <Button
            onClick={() => setIsCreateOpen(true)}
            disabled={!canCreate}
            title={
              canCreate
                ? undefined
                : hasPlan
                  ? "You’ve used all your workspace slots"
                  : "Choose a plan to create workspaces"
            }
          >
            <Plus aria-hidden="true" /> New workspace
          </Button>
        </div>
      </header>

      <WorkspaceHomeStats workspaces={workspaces} compute={compute} />

      {billing && !hasPlan ? (
        <SubscribeCallout
          pastDue={billing.pastDue ?? false}
          priceUsdPerMonth={billing.priceUsdPerMonth}
        />
      ) : null}
      <WorkspaceComputeAlerts computeSummary={compute} />

      {workspaces.length > 0 ? (
        <WorkspaceHomeToolbar
          query={searchQuery}
          onQueryChange={setSearchQuery}
          filter={filter}
          onFilterChange={setFilter}
          counts={counts}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      ) : null}

      <Gen2WorkspaceList
        workspaces={workspaces}
        viewMode={viewMode}
        searchQuery={searchQuery}
        filter={filter}
        canCreate={canCreate}
        onCreateWorkspace={() => setIsCreateOpen(true)}
        onClearFilters={() => {
          setSearchQuery("");
          setFilter("all");
        }}
        onDeleted={deleted}
      />

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="gen2-create-dialog sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              Start blank or import a GitHub repository into its own cloud
              machine. Nothing is created until you press Create.
            </DialogDescription>
          </DialogHeader>
          <CreateGen2WorkspaceForm
            githubConnected={github.connected}
            ownedWorkspaceCount={ownedCount}
            computeSummary={compute}
            appSlug={appSlug}
            connectGitHub={connectGitHub}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

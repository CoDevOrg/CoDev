"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  FolderGit2,
  Grid2X2,
  List,
  LogOut,
  Search,
  Trash2,
} from "lucide-react";

import { RepositoryPicker } from "@/components/workspace/repository-picker";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AppUser } from "@/lib/auth/identity";
import { cn } from "@/lib/platform/utils";

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

const SCOPE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "owner", label: "Owned" },
  { value: "member", label: "Shared" },
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

function accessLabel(workspace: WorkspaceItem) {
  if (workspace.repositoryVisibility === "private") return "Private";
  if (workspace.repository) return "Public";
  return "Blank";
}

function statusClass(status: string) {
  if (status === "ready" || status === "provisioning") {
    return "border-teal/30 bg-teal/10 text-teal";
  }
  if (status === "failed") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  return "border-border bg-muted text-muted-foreground";
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
  const [view, setView] = useState<WorkspaceView>("grid");
  const [scope, setScope] = useState<WorkspaceScope>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    workspace: WorkspaceItem;
    mode: "delete" | "leave";
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const greeting = useMemo(() => getGreeting(), []);

  const prewarmedRef = useRef<Set<string>>(new Set());
  const preparedRef = useRef<Set<string>>(new Set());
  const hoverIntentRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const prewarmWorkspace = useCallback((workspaceId: string) => {
    if (prewarmedRef.current.has(workspaceId)) {
      return;
    }
    prewarmedRef.current.add(workspaceId);
    void fetch(`/api/workspaces/${workspaceId}/wake`, {
      method: "POST",
      keepalive: true,
      cache: "no-store",
    }).catch(() => {});
  }, []);
  const prepareWorkspace = useCallback((workspaceId: string) => {
    if (preparedRef.current.has(workspaceId)) {
      return;
    }
    preparedRef.current.add(workspaceId);
    void fetch(`/api/workspaces/${workspaceId}/prepare`, {
      method: "POST",
      keepalive: true,
      cache: "no-store",
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
      const matchesScope = scope === "all" || workspace.role === scope;
      return matchesQuery && matchesScope;
    });
  }, [query, scope, sortedWorkspaces]);

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

  return (
    <main className="product-scope min-h-dvh px-8 py-11 sm:px-12">
      <div className="mx-auto flex max-w-[1160px] flex-col gap-7">
        <div className="flex flex-wrap items-end justify-between gap-7">
          <div>
            <span className="mb-2 inline-block text-[11px] font-bold tracking-[0.12em] text-primary uppercase">
              Workspace home
            </span>
            <h1 className="m-0 text-[42px] leading-[1.03] font-semibold tracking-tight">
              {greeting}, {firstName}
            </h1>
            <p className="mt-2.5 max-w-[460px] text-[14.5px] leading-relaxed text-muted-foreground">
              Build together with people and AI agents.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Card className="min-w-[108px] px-4 py-3">
              <strong className="block text-[22px] font-semibold tracking-tight">
                {workspaceList.length}
              </strong>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Workspaces
              </span>
            </Card>
            <Card className="min-w-[108px] px-4 py-3">
              <strong className="block text-[22px] font-semibold tracking-tight text-primary">
                {activeCount}
              </strong>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Active
              </span>
            </Card>
            {user?.githubLogin ? (
              <Card className="min-w-[108px] px-4 py-3">
                <strong className="block text-[15px] font-semibold tracking-tight">
                  @{user.githubLogin}
                </strong>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  GitHub
                </span>
              </Card>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-[42px] min-w-[240px] flex-1 items-center gap-2 rounded-full border border-border bg-card px-3.5 sm:max-w-[320px] sm:flex-none">
            <Search
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            <Input
              type="search"
              placeholder="Search workspaces…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search workspaces"
              className="h-auto border-0 bg-transparent p-0 text-[13.5px] shadow-none focus-visible:ring-0"
            />
          </div>

          <ToggleGroup
            type="single"
            layoutId="workspace-scope-pill"
            value={scope}
            onValueChange={(value) =>
              value && setScope(value as WorkspaceScope)
            }
          >
            {SCOPE_OPTIONS.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="flex-1" />

          <ToggleGroup
            type="single"
            layoutId="workspace-view-pill"
            value={view}
            onValueChange={(value) => value && setView(value as WorkspaceView)}
            aria-label="Workspace view"
          >
            <ToggleGroupItem value="grid" aria-label="Grid view">
              <Grid2X2 aria-hidden="true" className="size-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view">
              <List aria-hidden="true" className="size-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div
          className={cn(
            "grid gap-4.5",
            view === "list"
              ? "grid-cols-1"
              : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
          <RepositoryPicker
            appSlug={appSlug}
            githubAuthConfigured={githubAuthConfigured}
            githubConnected={Boolean(user?.githubLogin)}
          />

          {filteredWorkspaces.map((workspace) => {
            const mode =
              workspace.role === "owner"
                ? ("delete" as const)
                : ("leave" as const);
            const title = workspace.repository || "Untitled workspace";
            const actionLabel = `${mode === "leave" ? "Leave" : "Delete"} ${title}`;

            return (
              <motion.div
                key={workspace.id}
                className="relative"
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.98 }}
              >
                <Link
                  href={`/workspaces/${workspace.id}`}
                  className="block h-full"
                  aria-label={`Open ${title}`}
                  onPointerEnter={() => armPrewarm(workspace.id)}
                  onPointerLeave={() => disarmPrewarm(workspace.id)}
                  onFocus={() => prewarmWorkspace(workspace.id)}
                  onPointerDown={() => prepareWorkspace(workspace.id)}
                >
                  <Card
                    className={cn(
                      "flex h-full flex-col gap-3.5 p-5 transition-colors hover:border-input hover:bg-secondary",
                      view === "list" && "sm:flex-row sm:items-center sm:gap-5",
                    )}
                  >
                    <div
                      className={cn(
                        "rounded-xl border border-border bg-muted/60 p-3.5",
                        view === "list" && "sm:min-w-[200px] sm:flex-none",
                      )}
                      aria-label={
                        workspace.liveCollaborators?.length
                          ? `${workspace.liveCollaborators.length} collaborator${workspace.liveCollaborators.length === 1 ? "" : "s"} live now`
                          : "No collaborators live now"
                      }
                    >
                      <span className="block text-[10px] font-bold tracking-[0.1em] text-muted-foreground uppercase">
                        In this workspace
                      </span>
                      {workspace.liveCollaborators?.length ? (
                        <div className="mt-2.5 flex items-center">
                          {workspace.liveCollaborators.map((collaborator) =>
                            collaborator.avatarUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- Presence avatars can originate from a member's identity provider, so they cannot use a fixed Next image allowlist.
                              <img
                                key={collaborator.id}
                                src={collaborator.avatarUrl}
                                alt={collaboratorName(collaborator)}
                                title={`${collaboratorName(collaborator)} is active now`}
                                className="-ml-2 size-8 rounded-full border-2 border-card object-cover first:ml-0"
                              />
                            ) : (
                              <Avatar
                                key={collaborator.id}
                                className="-ml-2 size-8 border-2 border-card first:ml-0"
                                title={`${collaboratorName(collaborator)} is active now`}
                              >
                                <AvatarFallback
                                  aria-label={`${collaboratorName(collaborator)} is active now`}
                                >
                                  {collaboratorName(collaborator).slice(0, 1)}
                                </AvatarFallback>
                              </Avatar>
                            ),
                          )}
                          <small className="ml-2.5 text-[11px] font-semibold text-foreground">
                            Live now
                          </small>
                        </div>
                      ) : (
                        <p className="mt-2.5 mb-0 text-[13px] text-muted-foreground">
                          No one is active right now
                        </p>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={statusClass(workspace.status)}
                        >
                          {workspace.status}
                        </Badge>
                        <Badge variant="outline">
                          {accessLabel(workspace)}
                        </Badge>
                      </div>
                      <h3 className="mt-2.5 mb-0 text-[16px] leading-tight font-semibold tracking-tight">
                        {title}
                      </h3>
                      <p className="mt-1.5 mb-0 text-[12.5px] text-muted-foreground">
                        {workspace.repository
                          ? `${workspace.defaultBranch || "No branch"} · ${workspace.baseSha.slice(0, 7)}`
                          : "No repository connected"}
                      </p>
                    </div>

                    <div
                      className={cn(
                        "mt-auto flex items-center justify-between border-t border-border pt-3",
                        view === "list" &&
                          "sm:mt-0 sm:w-28 sm:flex-none sm:flex-col sm:items-end sm:border-0 sm:pt-0 sm:text-right",
                      )}
                    >
                      <span className="text-[12px] text-muted-foreground">
                        {formatUpdatedAt(workspace.updatedAt)}
                      </span>
                      <FolderGit2
                        aria-hidden="true"
                        className="size-4 text-muted-foreground"
                      />
                    </div>
                  </Card>
                </Link>

                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={actionLabel}
                  title={
                    mode === "leave" ? "Leave workspace" : "Delete workspace"
                  }
                  className="absolute top-3 right-3 z-10 rounded-full border-border bg-card/90 text-muted-foreground shadow-sm hover:text-foreground"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setPendingAction({ workspace, mode });
                  }}
                >
                  {mode === "leave" ? (
                    <LogOut aria-hidden="true" className="size-3.5" />
                  ) : (
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  )}
                </Button>
              </motion.div>
            );
          })}
        </div>

        {!filteredWorkspaces.length && sortedWorkspaces.length ? (
          <Card className="grid justify-items-center gap-3 border-dashed px-6 py-14 text-center">
            <FolderGit2 aria-hidden="true" className="size-7 text-primary" />
            <h2 className="m-0 text-[18px] font-semibold">
              No workspaces match
            </h2>
            <p className="m-0 text-[13px] text-muted-foreground">
              Try a different search or filter.
            </p>
          </Card>
        ) : null}

        {pendingAction
          ? (() => {
              const { workspace, mode } = pendingAction;
              const busy = busyId === workspace.id;
              const name = workspace.repository || "this workspace";
              const isLeave = mode === "leave";
              const cancel = () => {
                if (!busy) {
                  setPendingAction(null);
                  setActionError(null);
                }
              };
              return (
                <div
                  className="fixed inset-0 z-[1000] flex items-center justify-center bg-foreground/28 p-4"
                  role="presentation"
                  onClick={cancel}
                >
                  <Card
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="workspace-action-title"
                    className="w-full max-w-[420px] bg-popover p-6 shadow-xl"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") cancel();
                    }}
                  >
                    <h3
                      id="workspace-action-title"
                      className="m-0 text-[16px] font-bold"
                    >
                      {isLeave ? "Leave workspace?" : "Delete workspace?"}
                    </h3>
                    <p className="mt-2 mb-4 text-[13px] leading-relaxed text-muted-foreground">
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
                      <p className="mb-3 text-[12px] text-destructive">
                        {actionError}
                      </p>
                    ) : null}
                    <div className="flex justify-end gap-2.5">
                      <Button
                        type="button"
                        variant="outline"
                        autoFocus
                        disabled={busy}
                        onClick={cancel}
                        className="rounded-full"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => void runPendingAction()}
                        className="rounded-full"
                        style={
                          isLeave
                            ? {
                                background: "var(--color-orange)",
                                color: "var(--color-primary-foreground)",
                              }
                            : {
                                background: "var(--color-destructive)",
                                color: "var(--color-primary-foreground)",
                              }
                        }
                      >
                        {busy
                          ? isLeave
                            ? "Leaving..."
                            : "Deleting..."
                          : isLeave
                            ? "Leave workspace"
                            : "Delete workspace"}
                      </Button>
                    </div>
                  </Card>
                </div>
              );
            })()
          : null}
      </div>
    </main>
  );
}

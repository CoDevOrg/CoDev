"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Plus, Search } from "lucide-react";

import { GithubMark } from "@/components/settings/github-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GEN2_MAX_OWNED_WORKSPACES } from "@/lib/gen2/constants";
import { cn } from "@/lib/platform/utils";

type Installation = {
  id: number;
  account: { login: string; avatar_url: string };
};
type Repository = {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
};

type Loaded<T> = { key: string; status: "ok" | "error"; items: T[] };

const REPOSITORY_PAGE_SIZE = 40;

/**
 * Start a workspace: blank, or from a GitHub repository.
 *
 * Nothing is created until "Create workspace" is pressed: choosing a source and
 * a repository only fills in the form, so a stray click can't spend one of the
 * member's few workspaces.
 *
 * The repository never arrives through the browser. Picking one records the
 * installation and repository ids; the control plane resolves the commit and
 * either hands the guest a plain public clone URL or ships a bounded snapshot
 * it fetched itself. No GitHub token reaches the machine.
 */
export function CreateGen2WorkspaceForm({
  githubConnected,
  ownedWorkspaceCount = 0,
  appSlug,
  connectGitHub,
}: {
  githubConnected: boolean;
  ownedWorkspaceCount?: number;
  appSlug?: string | undefined;
  /**
   * The bound `connectGitHubAccount` server action, handed down rather than
   * imported: importing it here would pull the auth stack into every client
   * bundle that renders this form.
   */
  connectGitHub?: (() => void) | undefined;
}) {
  const router = useRouter();
  const atWorkspaceLimit = ownedWorkspaceCount >= GEN2_MAX_OWNED_WORKSPACES;
  const [source, setSource] = useState<"blank" | "github">("blank");
  const [name, setName] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [installs, setInstalls] = useState<Loaded<Installation> | null>(null);
  const [installationId, setInstallationId] = useState<number | null>(null);
  const [repos, setRepos] = useState<Loaded<Repository> | null>(null);
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Loading is derived, not stored: a result belongs to the request key that
  // produced it, so "no result for the current key yet" means "loading".
  const installKey = String(reloadKey);
  const repoKey = `${installationId}:${reloadKey}`;
  const installsLoading = githubConnected && installs?.key !== installKey;
  const reposLoading =
    source === "github" && installationId !== null && repos?.key !== repoKey;

  useEffect(() => {
    if (!githubConnected) return;
    let cancelled = false;
    void (async () => {
      let loaded: Loaded<Installation>;
      try {
        const response = await fetch("/api/github/installations");
        const payload = response.ok
          ? ((await response.json()) as { installations?: Installation[] })
          : null;
        loaded = {
          key: installKey,
          status: payload ? "ok" : "error",
          items: payload?.installations ?? [],
        };
      } catch {
        loaded = { key: installKey, status: "error", items: [] };
      }
      if (cancelled) return;
      setInstalls(loaded);
      setInstallationId((current) => current ?? loaded.items[0]?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [githubConnected, installKey]);

  useEffect(() => {
    if (source !== "github" || installationId === null) return;
    let cancelled = false;
    void (async () => {
      let loaded: Loaded<Repository>;
      try {
        const response = await fetch(
          `/api/github/installations/${installationId}/repositories`,
        );
        const payload = response.ok
          ? ((await response.json()) as { repositories?: Repository[] })
          : null;
        loaded = {
          key: repoKey,
          status: payload ? "ok" : "error",
          items: payload?.repositories ?? [],
        };
      } catch {
        loaded = { key: repoKey, status: "error", items: [] };
      }
      if (!cancelled) setRepos(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [source, installationId, repoKey]);

  const repositories = useMemo(
    () => (repos?.key === repoKey ? repos.items : []),
    [repos, repoKey],
  );
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? repositories.filter((repo) =>
          repo.full_name.toLowerCase().includes(needle),
        )
      : repositories;
  }, [repositories, query]);
  const visible = matches.slice(0, REPOSITORY_PAGE_SIZE);
  const selectedRepo =
    repositories.find((repo) => repo.id === selectedRepoId) ?? null;
  const loadFailed =
    installs?.key === installKey && installs.status === "error"
      ? true
      : repos?.key === repoKey && repos.status === "error";
  const canCreate =
    !busy && !atWorkspaceLimit && (source === "blank" || selectedRepo !== null);

  async function create() {
    const trimmedName = name.trim();
    const body: Record<string, unknown> = {};
    if (trimmedName) body.name = trimmedName;
    if (source === "github" && selectedRepo && installationId !== null) {
      body.installationId = installationId;
      body.repositoryId = selectedRepo.id;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/gen2/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        workspace?: { id: string };
        error?: string;
      };
      if (!response.ok || !payload.workspace) {
        setError(payload.error ?? "The workspace could not be created.");
        return;
      }
      router.push(`/gen2/${payload.workspace.id}`);
      router.refresh();
    } catch {
      setError("Couldn't reach CoDev. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const summary =
    source === "github"
      ? selectedRepo
        ? `Creates a workspace from ${selectedRepo.full_name}.`
        : "Choose a repository to continue."
      : "Creates an empty workspace.";

  return (
    <Card>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canCreate) void create();
        }}
      >
        <CardHeader className="flex-row items-start justify-between gap-4 px-6 pt-6">
          <div className="space-y-1.5">
            <CardTitle className="text-base">New workspace</CardTitle>
            <CardDescription>
              Pick a starting point. Nothing is created until you press Create.
            </CardDescription>
          </div>
          <Badge
            aria-label={`You own ${ownedWorkspaceCount} of ${GEN2_MAX_OWNED_WORKSPACES} workspaces`}
            variant={atWorkspaceLimit ? "default" : "muted"}
          >
            {ownedWorkspaceCount} of {GEN2_MAX_OWNED_WORKSPACES} used
          </Badge>
        </CardHeader>

        <CardContent className="space-y-5 px-6 pt-5 pb-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Start from</legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              {(
                [
                  {
                    id: "blank",
                    title: "Blank workspace",
                    hint: "An empty machine to build in",
                    icon: <Plus aria-hidden="true" size={16} />,
                  },
                  {
                    id: "github",
                    title: "GitHub repository",
                    hint: "Clone one of your repositories",
                    icon: <GithubMark className="size-4" />,
                  },
                ] as const
              ).map((option) => (
                <button
                  aria-checked={source === option.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    source === option.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-accent",
                  )}
                  key={option.id}
                  onClick={() => setSource(option.id)}
                  role="radio"
                  type="button"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                    {option.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{option.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          {source === "github" ? (
            githubConnected ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  {(installs?.items.length ?? 0) > 1 ? (
                    <select
                      aria-label="GitHub account"
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      onChange={(event) => {
                        setInstallationId(Number(event.target.value));
                        setSelectedRepoId(null);
                      }}
                      value={installationId ?? ""}
                    >
                      {installs?.items.map((installation) => (
                        <option key={installation.id} value={installation.id}>
                          {installation.account.login}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <div className="relative min-w-[14rem] flex-1">
                    <Search
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                      size={14}
                    />
                    <Input
                      aria-label="Search repositories"
                      autoComplete="off"
                      className="pl-9"
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search your repositories"
                      value={query}
                    />
                  </div>
                </div>

                <p className="text-sm font-medium">Your repositories</p>

                {installsLoading || reposLoading ? (
                  <div
                    aria-busy="true"
                    aria-label="Loading repositories"
                    className="space-y-2"
                    role="status"
                  >
                    {[0, 1, 2].map((row) => (
                      <div
                        className="h-10 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
                        key={row}
                      />
                    ))}
                  </div>
                ) : loadFailed ? (
                  <div
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 px-4 py-3 text-sm"
                    role="alert"
                  >
                    <span className="text-destructive">
                      Couldn&apos;t load your repositories from GitHub.
                    </span>
                    <Button
                      onClick={() => setReloadKey((value) => value + 1)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Try again
                    </Button>
                  </div>
                ) : visible.length > 0 ? (
                  <>
                    <ul
                      aria-label="Repositories"
                      className="max-h-72 divide-y divide-border overflow-auto rounded-lg border border-border"
                    >
                      {visible.map((repo) => {
                        const selected = repo.id === selectedRepoId;
                        return (
                          <li key={repo.id}>
                            <button
                              aria-pressed={selected}
                              className={cn(
                                "flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors outline-none focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
                                selected ? "bg-primary/5" : "hover:bg-accent",
                              )}
                              onClick={() => setSelectedRepoId(repo.id)}
                              type="button"
                            >
                              <GithubMark className="size-4 shrink-0" />
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {repo.full_name}
                              </span>
                              {repo.private ? (
                                <Badge variant="outline">Private</Badge>
                              ) : null}
                              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                                {repo.default_branch}
                              </span>
                              {selected ? (
                                <Check
                                  aria-hidden="true"
                                  className="size-4 shrink-0 text-primary"
                                />
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      {matches.length > visible.length
                        ? `Showing ${visible.length} of ${matches.length}. Search to narrow the list.`
                        : `${matches.length} ${matches.length === 1 ? "repository" : "repositories"}`}
                    </p>
                  </>
                ) : query.trim() && repositories.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No repositories match &ldquo;{query.trim()}&rdquo;.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No repositories yet.
                    {appSlug ? (
                      <>
                        {" "}
                        <a
                          className="underline underline-offset-4 hover:text-foreground"
                          href={`https://github.com/apps/${appSlug}/installations/new`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Give CoDev access to some
                        </a>
                        .
                      </>
                    ) : null}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-4">
                <p className="text-sm text-muted-foreground">
                  Connect GitHub to start from one of your repositories.
                </p>
                {/* Not a submit button: pressing Enter in the name field must
                    create the workspace, not start the GitHub connection. */}
                <Button
                  onClick={() => startTransition(() => connectGitHub?.())}
                  type="button"
                  variant="outline"
                >
                  <GithubMark className="size-4" /> Connect GitHub
                </Button>
              </div>
            )
          ) : null}

          <div className="max-w-sm space-y-2">
            <Label htmlFor="gen2-workspace-name">Name (optional)</Label>
            <Input
              autoComplete="off"
              id="gen2-workspace-name"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="Untitled workspace"
              value={name}
            />
          </div>

          {atWorkspaceLimit ? (
            <p className="text-sm text-muted-foreground" role="status">
              You own {ownedWorkspaceCount} of {GEN2_MAX_OWNED_WORKSPACES} Gen 2
              workspaces. Delete one to create another.
            </p>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>

        <CardFooter className="justify-between gap-4 border-t border-border px-6 py-4">
          <p className="text-sm text-muted-foreground">{summary}</p>
          <Button disabled={!canCreate} type="submit">
            {busy ? (
              <>
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                  size={14}
                />
                Creating…
              </>
            ) : (
              "Create workspace"
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

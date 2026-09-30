"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";

import { GithubMark } from "@/components/settings/github-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GEN2_MAX_OWNED_WORKSPACES } from "@/lib/gen2/constants";

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

/**
 * Start a workspace: blank, or from a GitHub repository.
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
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [installationId, setInstallationId] = useState<number | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!githubConnected) return;
    void (async () => {
      const response = await fetch("/api/github/installations");
      if (!response.ok) return;
      const payload = (await response.json()) as {
        installations?: Installation[];
      };
      setInstallations(payload.installations ?? []);
      setInstallationId(
        (current) => current ?? payload.installations?.[0]?.id ?? null,
      );
    })();
  }, [githubConnected]);

  useEffect(() => {
    if (installationId === null) return;
    void (async () => {
      const response = await fetch(
        `/api/github/installations/${installationId}/repositories`,
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        repositories?: Repository[];
      };
      setRepositories(payload.repositories ?? []);
    })();
  }, [installationId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? repositories.filter((repo) =>
          repo.full_name.toLowerCase().includes(needle),
        )
      : repositories;
    return matches.slice(0, 40);
  }, [repositories, query]);

  async function create(body: Record<string, unknown>) {
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

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy || atWorkspaceLimit}
          onClick={() => void create({})}
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
          {busy ? "Creating…" : "Blank workspace"}
        </Button>

        {githubConnected ? (
          <>
            {installations.length > 1 ? (
              <select
                aria-label="GitHub account"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onChange={(event) =>
                  setInstallationId(Number(event.target.value))
                }
                value={installationId ?? ""}
              >
                {installations.map((installation) => (
                  <option key={installation.id} value={installation.id}>
                    {installation.account.login}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="relative min-w-[16rem] flex-1">
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
          </>
        ) : (
          <form action={connectGitHub}>
            <Button type="submit" variant="outline">
              <GithubMark className="size-4" /> Connect GitHub
            </Button>
          </form>
        )}
      </div>

      {atWorkspaceLimit ? (
        <p className="text-sm text-muted-foreground" role="status">
          You own {ownedWorkspaceCount} of {GEN2_MAX_OWNED_WORKSPACES} Gen 2
          workspaces. Delete one to create another.
        </p>
      ) : null}

      {githubConnected && visible.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {visible.map((repo) => (
            <li key={repo.id}>
              <button
                className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy || atWorkspaceLimit}
                onClick={() =>
                  void create({
                    installationId,
                    repositoryId: repo.id,
                  })
                }
                type="button"
              >
                <GithubMark className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {repo.full_name}
                </span>
                {repo.private ? <Badge variant="outline">Private</Badge> : null}
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {repo.default_branch}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {githubConnected && appSlug && repositories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No repositories yet.{" "}
          <a
            className="underline underline-offset-4 hover:text-foreground"
            href={`https://github.com/apps/${appSlug}/installations/new`}
            rel="noreferrer"
            target="_blank"
          >
            Give CoDev access to some
          </a>
          .
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

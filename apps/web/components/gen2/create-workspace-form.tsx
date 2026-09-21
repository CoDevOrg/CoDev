"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";

import { GithubMark } from "@/components/settings/github-mark";

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
  appSlug,
  connectGitHub,
}: {
  githubConnected: boolean;
  appSlug?: string | undefined;
  /**
   * The bound `connectGitHubAccount` server action, handed down rather than
   * imported: importing it here would pull the auth stack into every client
   * bundle that renders this form.
   */
  connectGitHub?: (() => void) | undefined;
}) {
  const router = useRouter();
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
    <section className="gen2-create">
      <div className="gen2-create-row">
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={() => void create({})}
        >
          <Plus aria-hidden="true" size={14} />
          {busy ? "Creating…" : "Blank workspace"}
        </button>

        {githubConnected ? (
          <>
            {installations.length > 1 ? (
              <select
                className="gen2-create-select"
                aria-label="GitHub account"
                value={installationId ?? ""}
                onChange={(event) =>
                  setInstallationId(Number(event.target.value))
                }
              >
                {installations.map((installation) => (
                  <option key={installation.id} value={installation.id}>
                    {installation.account.login}
                  </option>
                ))}
              </select>
            ) : null}
            <label className="gen2-create-search">
              <Search aria-hidden="true" size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search your repositories"
                aria-label="Search repositories"
                autoComplete="off"
              />
            </label>
          </>
        ) : (
          <form action={connectGitHub}>
            <button type="submit" className="secondary-button">
              <GithubMark className="gen2-repo-mark" /> Connect GitHub
            </button>
          </form>
        )}
      </div>

      {githubConnected && visible.length > 0 ? (
        <ul className="gen2-repo-list">
          {visible.map((repo) => (
            <li key={repo.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void create({
                    installationId,
                    repositoryId: repo.id,
                  })
                }
              >
                <GithubMark className="gen2-repo-mark" />
                <span className="gen2-repo-name">{repo.full_name}</span>
                {repo.private ? (
                  <span className="gen2-repo-tag">Private</span>
                ) : null}
                <span className="gen2-repo-branch">{repo.default_branch}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {githubConnected && appSlug && repositories.length === 0 ? (
        <p className="gen2-wb-hint">
          No repositories yet.{" "}
          <a
            href={`https://github.com/apps/${appSlug}/installations/new`}
            target="_blank"
            rel="noreferrer"
          >
            Give CoDev access to some
          </a>
          .
        </p>
      ) : null}

      {error ? (
        <p className="form-message error-copy" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

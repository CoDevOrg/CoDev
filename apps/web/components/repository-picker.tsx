"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { GitHubInstallation, GitHubRepository } from "@/lib/github";

type LoadState = "loading" | "ready" | "empty" | "error";

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "The request failed.");
  }
  return payload;
}

export function RepositoryPicker({ appSlug }: { appSlug: string | undefined }) {
  const router = useRouter();
  const [installations, setInstallations] = useState<GitHubInstallation[]>([]);
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [installationId, setInstallationId] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/github/installations")
      .then((response) =>
        readJson<{ installations: GitHubInstallation[] }>(response),
      )
      .then(({ installations: loaded }) => {
        if (!active) return;
        setInstallations(loaded);
        setState(loaded.length ? "ready" : "empty");
      })
      .catch((error: Error) => {
        if (!active) return;
        setMessage(error.message);
        setState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  async function loadRepositories(value: string) {
    setInstallationId(value);
    setRepositoryId("");
    setRepositories([]);
    setMessage("");
    if (!value) return;

    setState("loading");
    try {
      const payload = await readJson<{ repositories: GitHubRepository[] }>(
        await fetch(`/api/github/installations/${value}/repositories`),
      );
      setRepositories(payload.repositories);
      setState(payload.repositories.length ? "ready" : "empty");
      if (!payload.repositories.length) {
        setMessage("This installation has no eligible public repositories.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "GitHub request failed.",
      );
      setState("error");
    }
  }

  async function createWorkspace() {
    if (!installationId || !repositoryId) return;
    setCreating(true);
    setMessage("");
    try {
      const payload = await readJson<{ workspace: { id: string } }>(
        await fetch("/api/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            installationId: Number(installationId),
            repositoryId: Number(repositoryId),
          }),
        }),
      );
      router.push(`/workspaces/${payload.workspace.id}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Creation failed.");
      setCreating(false);
    }
  }

  const installUrl = appSlug
    ? `https://github.com/apps/${appSlug}/installations/new`
    : "https://github.com/settings/installations";

  return (
    <section className="panel repository-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">New workspace</p>
          <h2>Choose a public repository</h2>
        </div>
        <a className="secondary-button" href={installUrl} target="_blank">
          Manage GitHub App ↗
        </a>
      </div>
      <div className="picker-grid">
        <label>
          <span>Installation</span>
          <select
            value={installationId}
            onChange={(event) => void loadRepositories(event.target.value)}
            disabled={state === "loading" && installations.length === 0}
          >
            <option value="">Select an account</option>
            {installations.map((installation) => (
              <option key={installation.id} value={installation.id}>
                {installation.account.login} · {installation.account.type}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Repository</span>
          <select
            value={repositoryId}
            onChange={(event) => setRepositoryId(event.target.value)}
            disabled={!installationId || state === "loading"}
          >
            <option value="">Select a repository</option>
            {repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.full_name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary-button picker-submit"
          type="button"
          disabled={!repositoryId || creating}
          onClick={() => void createWorkspace()}
        >
          {creating ? "Creating…" : "Create workspace"}
        </button>
      </div>
      {state === "loading" ? (
        <p className="panel-status">Loading GitHub access…</p>
      ) : null}
      {state === "empty" && !message ? (
        <p className="panel-status">
          Install CoDev on a GitHub account to make repositories available.
        </p>
      ) : null}
      {message ? (
        <p className={`panel-status ${state === "error" ? "error-copy" : ""}`}>
          {message}
        </p>
      ) : null}
      <p className="security-note">
        Private repositories are intentionally excluded in this release.
      </p>
    </section>
  );
}

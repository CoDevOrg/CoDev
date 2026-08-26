"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { connectGitHubAccount } from "@/app/actions/github";
import type { GitHubInstallation, GitHubRepository } from "@/lib/github";

type LoadState = "loading" | "ready" | "empty" | "error";

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "The request failed.");
  }
  return payload;
}

export function RepositoryPicker({
  appSlug,
  githubAuthConfigured,
  githubConnected,
}: {
  appSlug: string | undefined;
  githubAuthConfigured: boolean;
  githubConnected: boolean;
}) {
  const router = useRouter();
  const [installations, setInstallations] = useState<GitHubInstallation[]>([]);
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [installationId, setInstallationId] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || !githubConnected) return;
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
  }, [open, githubConnected]);

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
        setMessage("This installation has no eligible repositories.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "GitHub request failed.",
      );
      setState("error");
    }
  }

  async function createWorkspace(
    options: { installationId?: number; repositoryId?: number } = {},
  ) {
    if (
      (options.installationId === undefined) !==
      (options.repositoryId === undefined)
    ) {
      return;
    }
    setCreating(true);
    setMessage("");
    try {
      const payload = await readJson<{ workspace: { id: string } }>(
        await fetch("/api/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options),
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
    <>
      <button
        className="new-workspace-tile"
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className="new-workspace-plus" aria-hidden="true">
          +
        </span>
        <strong>New workspace</strong>
        <span>Start with a blank document or a GitHub repository.</span>
      </button>
      {open ? (
        <div
          className="workspace-create-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
        >
          <section
            className="workspace-create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-create-title"
          >
            <div className="workspace-create-heading">
              <div>
                <p className="eyebrow">New workspace</p>
                <h2 id="workspace-create-title">Choose how to begin.</h2>
                <p>
                  Start with a blank workspace for planning, or connect a
                  repository when you are ready to build.
                </p>
              </div>
              <button
                className="modal-close-button"
                type="button"
                aria-label="Close workspace creation"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="workspace-create-options">
              <button
                className="workspace-create-blank"
                type="button"
                disabled={creating}
                onClick={() => void createWorkspace()}
              >
                <span
                  className="workspace-create-option-icon"
                  aria-hidden="true"
                >
                  +
                </span>
                <span>
                  <strong>{creating ? "Creating…" : "Blank workspace"}</strong>
                  <small>Create a document now and connect GitHub later.</small>
                </span>
              </button>
            </div>
            <div className="workspace-create-divider">
              <span>or connect GitHub</span>
            </div>
            {!githubConnected ? (
              <div className="workspace-create-connect">
                <p>
                  Connect your GitHub account to open one of your
                  repositories in a new workspace.
                </p>
                {githubAuthConfigured ? (
                  <form action={connectGitHubAccount.bind(null, "/dashboard")}>
                    <button
                      className="primary-button picker-submit"
                      type="submit"
                    >
                      Connect GitHub
                    </button>
                  </form>
                ) : (
                  <p className="panel-status">
                    GitHub account linking is not configured.
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="picker-grid">
                  <label>
                    <span>Installation</span>
                    <select
                      value={installationId}
                      onChange={(event) =>
                        void loadRepositories(event.target.value)
                      }
                      disabled={
                        state === "loading" && installations.length === 0
                      }
                    >
                      <option value="">Select an account</option>
                      {installations.map((installation) => (
                        <option key={installation.id} value={installation.id}>
                          {installation.account.login} ·{" "}
                          {installation.account.type}
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
                          {repository.private ? "Private · " : ""}
                          {repository.full_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary-button picker-submit"
                    type="button"
                    disabled={!repositoryId || creating}
                    onClick={() =>
                      void createWorkspace({
                        installationId: Number(installationId),
                        repositoryId: Number(repositoryId),
                      })
                    }
                  >
                    {creating ? "Creating…" : "Create workspace"}
                  </button>
                </div>
                {state === "loading" ? (
                  <p className="panel-status">Loading GitHub access…</p>
                ) : null}
                {state === "empty" && !message ? (
                  <p className="panel-status">
                    Install CoDev on a GitHub account to make repositories
                    available.
                  </p>
                ) : null}
                {message ? (
                  <p
                    className={`panel-status ${state === "error" ? "error-copy" : ""}`}
                  >
                    {message}
                  </p>
                ) : null}
                <div className="workspace-create-footer">
                  <div className="workspace-create-github-help">
                    <strong>Need to change repository access?</strong>
                    <span>
                      This opens your existing CoDev installation settings on
                      GitHub.
                    </span>
                  </div>
                  <a
                    className="secondary-button"
                    href={installUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Manage repository access ↗
                  </a>
                  <p className="security-note">
                    Private source is transferred as a bounded,
                    credential-free snapshot. GitHub tokens never enter the
                    sandbox.
                  </p>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { connectGitHubAccount } from "@/app/actions/github";
import type { GitHubInstallation, GitHubRepository } from "@/lib/github";

type LoadState = "loading" | "ready" | "empty" | "error";

type RepositoryChoice = GitHubRepository & {
  installationId: number;
  sharedBy: string | null;
};

function isViewerAccount(
  installation: GitHubInstallation,
  viewerLogin: string | null,
) {
  return (
    installation.account.type === "User" &&
    Boolean(viewerLogin) &&
    installation.account.login.toLowerCase() === viewerLogin!.toLowerCase()
  );
}

/**
 * `/user/installations` also returns installations on other people's personal
 * accounts whenever the member collaborates on a repository there. Those are
 * not accounts the member can pick from, so they never reach the account list;
 * their repositories are folded into the member's own account instead, tagged
 * with the owner who shared them.
 */
function partitionInstallations(
  installations: GitHubInstallation[],
  viewerLogin: string | null,
) {
  const owned = installations.filter(
    (installation) =>
      installation.account.type === "Organization" ||
      isViewerAccount(installation, viewerLogin),
  );
  const shared = installations.filter(
    (installation) => !owned.includes(installation),
  );
  // Without a resolvable login every personal installation looks shared, which
  // would leave the member nothing to select. Fall back to the full list.
  if (owned.length === 0) return { owned: installations, shared: [] };
  return { owned, shared };
}

function accountLabel(
  installation: GitHubInstallation,
  viewerLogin: string | null,
) {
  if (installation.account.type === "Organization") {
    return `${installation.account.login} · Organization`;
  }
  return isViewerAccount(installation, viewerLogin)
    ? `${installation.account.login} · Your account`
    : `${installation.account.login} · Shared with you`;
}

function repositoryLabel(repository: RepositoryChoice) {
  const access = repository.private ? "Private · " : "";
  return repository.sharedBy
    ? `${access}${repository.full_name} · shared by ${repository.sharedBy}`
    : `${access}${repository.full_name}`;
}

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
  const [viewerLogin, setViewerLogin] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<RepositoryChoice[]>([]);
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
        readJson<{
          installations: GitHubInstallation[];
          login: string | null;
        }>(response),
      )
      .then(({ installations: loaded, login }) => {
        if (!active) return;
        setViewerLogin(login ?? null);
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

  const accountOptions = useMemo(
    () => partitionInstallations(installations, viewerLogin).owned,
    [installations, viewerLogin],
  );

  async function loadRepositories(value: string) {
    setInstallationId(value);
    setRepositoryId("");
    setRepositories([]);
    setMessage("");
    if (!value) return;

    const selected = installations.find(
      (installation) => String(installation.id) === value,
    );
    if (!selected) return;
    // Repositories other people shared with the member live in their own
    // installations, so opening the member's account means loading those too.
    const targets = isViewerAccount(selected, viewerLogin)
      ? [selected, ...partitionInstallations(installations, viewerLogin).shared]
      : [selected];

    setState("loading");
    try {
      const groups = await Promise.all(
        targets.map(async (installation) => {
          const payload = await readJson<{ repositories: GitHubRepository[] }>(
            await fetch(
              `/api/github/installations/${installation.id}/repositories`,
            ),
          );
          return payload.repositories.map((repository) => ({
            ...repository,
            installationId: installation.id,
            sharedBy:
              installation.id === selected.id
                ? null
                : installation.account.login,
          }));
        }),
      );
      const loaded = groups
        .flat()
        .sort((left, right) => left.full_name.localeCompare(right.full_name));
      setRepositories(loaded);
      setState(loaded.length ? "ready" : "empty");
      if (!loaded.length) {
        setMessage("This account has no eligible repositories.");
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
                  Connect your GitHub account to open one of your repositories
                  in a new workspace.
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
                      {accountOptions.map((installation) => (
                        <option key={installation.id} value={installation.id}>
                          {accountLabel(installation, viewerLogin)}
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
                        <option
                          key={`${repository.installationId}:${repository.id}`}
                          value={`${repository.installationId}:${repository.id}`}
                        >
                          {repositoryLabel(repository)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary-button picker-submit"
                    type="button"
                    disabled={!repositoryId || creating}
                    onClick={() => {
                      const [selectedInstallation, selectedRepository] =
                        repositoryId.split(":");
                      void createWorkspace({
                        installationId: Number(selectedInstallation),
                        repositoryId: Number(selectedRepository),
                      });
                    }}
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
                    Private source is transferred as a bounded, credential-free
                    snapshot. GitHub tokens never enter the sandbox.
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import type { GitHubInstallation, GitHubRepository } from "@/lib/github";

type RepositoryChoice = GitHubRepository & { installationId: number };
type LoadState = "idle" | "loading" | "ready" | "empty" | "error";

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "The request failed.");
  }
  return payload;
}

export function WorkspaceRepositoryDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [repositories, setRepositories] = useState<RepositoryChoice[]>([]);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<LoadState>("idle");
  const [message, setMessage] = useState("");
  const [openingRepositoryId, setOpeningRepositoryId] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();

    void (async () => {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setState("loading");
      setMessage("");
      try {
        const { installations } = await readJson<{
          installations: GitHubInstallation[];
        }>(
          await fetch("/api/github/installations", {
            signal: controller.signal,
          }),
        );
        const repositoryGroups = await Promise.all(
          installations.map(async (installation) => {
            const payload = await readJson<{
              repositories: GitHubRepository[];
            }>(
              await fetch(
                `/api/github/installations/${installation.id}/repositories`,
                { signal: controller.signal },
              ),
            );
            return payload.repositories.map((repository) => ({
              ...repository,
              installationId: installation.id,
            }));
          }),
        );
        if (controller.signal.aborted) return;
        const loaded = repositoryGroups
          .flat()
          .sort((left, right) => left.full_name.localeCompare(right.full_name));
        setRepositories(loaded);
        setState(loaded.length > 0 ? "ready" : "empty");
      } catch (error) {
        if (controller.signal.aborted) return;
        setMessage(
          error instanceof Error ? error.message : "GitHub request failed.",
        );
        setState("error");
      }
    })();

    return () => controller.abort();
  }, [open]);

  const visibleRepositories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return repositories;
    return repositories.filter((repository) =>
      repository.full_name.toLowerCase().includes(normalizedQuery),
    );
  }, [query, repositories]);

  async function openRepository(repository: RepositoryChoice) {
    setOpeningRepositoryId(repository.id);
    setMessage("");
    try {
      const payload = await readJson<{ workspace: { id: string } }>(
        await fetch("/api/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            installationId: repository.installationId,
            repositoryId: repository.id,
          }),
        }),
      );
      router.push(`/workspaces/${payload.workspace.id}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Creation failed.");
      setOpeningRepositoryId(null);
    }
  }

  if (!open) return null;

  return (
    <div
      className="workspace-create-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.currentTarget === event.target &&
          openingRepositoryId === null
        ) {
          onClose();
        }
      }}
    >
      <section
        className="workspace-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-repository-title"
      >
        <div className="workspace-create-heading">
          <div>
            <p className="eyebrow">GitHub repositories</p>
            <h2 id="workspace-repository-title">Open a repository</h2>
            <p>
              Choose any repository already authorized through your CoDev GitHub
              connection. It opens in its own workspace.
            </p>
          </div>
          <button
            className="modal-close-button"
            type="button"
            aria-label="Close repository picker"
            disabled={openingRepositoryId !== null}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="picker-grid">
          <label>
            <span>Search repositories</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="owner/repository"
              autoFocus
            />
          </label>
        </div>

        {state === "loading" ? (
          <p className="panel-status">Loading your GitHub repositories…</p>
        ) : null}
        {state === "empty" ? (
          <p className="panel-status">
            No repositories are available to your GitHub installation.
          </p>
        ) : null}
        {message ? <p className="panel-status error-copy">{message}</p> : null}

        {state === "ready" ? (
          <div
            className="workspace-create-options"
            style={{ maxHeight: "22rem", overflowY: "auto" }}
          >
            {visibleRepositories.map((repository) => (
              <button
                className="workspace-create-blank"
                type="button"
                key={`${repository.installationId}:${repository.id}`}
                disabled={openingRepositoryId !== null}
                onClick={() => void openRepository(repository)}
              >
                <span
                  className="workspace-create-option-icon"
                  aria-hidden="true"
                >
                  {repository.private ? "●" : "↗"}
                </span>
                <span>
                  <strong>{repository.full_name}</strong>
                  <small>
                    {openingRepositoryId === repository.id
                      ? "Opening…"
                      : repository.private
                        ? "Private repository"
                        : repository.description || "Public repository"}
                  </small>
                </span>
              </button>
            ))}
            {visibleRepositories.length === 0 ? (
              <p className="panel-status">No repositories match your search.</p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

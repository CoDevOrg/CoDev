"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  Files,
  GitBranch,
  Plus,
  RefreshCw,
  SquareTerminal,
} from "lucide-react";
import { parseGitStatus } from "@/lib/runtime/ide";

import { Gen2TerminalPane } from "./terminal-pane";
import {
  createSupersetWorktree,
  DEFAULT_SUPERSET_WORKTREE_ID,
  listSupersetWorktrees,
  SupersetFileApiError,
} from "./superset-file-client";
import { SupersetFilePane } from "./superset-file-pane";

type Tab = "files" | "changes" | "terminal";

type Worktree = { worktreeId: string; branch: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof SupersetFileApiError ? error.message : fallback;
}

function SupersetChangesPane({
  workspaceId,
  worktreeId,
  visible,
}: {
  workspaceId: string;
  worktreeId: string;
  visible: boolean;
}) {
  const [status, setStatus] = useState("");
  const [diff, setDiff] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ worktreeId });
      const base = `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/git`;
      const [statusResponse, diffResponse] = await Promise.all([
        fetch(`${base}?${query}&operation=status`),
        fetch(`${base}?${query}&operation=diff`),
      ]);
      const statusPayload = (await statusResponse.json().catch(() => ({}))) as {
        output?: string;
        error?: string;
      };
      if (!statusResponse.ok) {
        setError(statusPayload.error ?? "Couldn’t read the Git status.");
        return;
      }
      const diffPayload = (await diffResponse.json().catch(() => ({}))) as {
        output?: string;
      };
      setStatus(statusPayload.output ?? "");
      setDiff(diffResponse.ok ? (diffPayload.output ?? "") : "");
      setError("");
    } catch {
      setError("Couldn’t reach CoDev. Try refreshing Changes.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, worktreeId]);

  useEffect(() => {
    // The asynchronous continuation owns state updates after the initial
    // render; the rule cannot infer that boundary through refresh().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (visible) void refresh();
  }, [visible, refresh]);

  const files = [...parseGitStatus(status)].map(([path, code]) => ({
    path,
    code,
  }));

  return (
    <section
      id="superset-panel-changes"
      role="tabpanel"
      aria-labelledby="superset-tab-changes"
      hidden={!visible}
      className="gen2-superset-tool-panel"
    >
      <header className="gen2-superset-tool-header">
        <div>
          <h2>Changes</h2>
          <p>
            {files.length
              ? `${files.length} changed file${files.length === 1 ? "" : "s"}`
              : "Working tree is clean"}
          </p>
        </div>
        <button
          type="button"
          className="gen2-superset-icon-button"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh changes"
        >
          <RefreshCw aria-hidden="true" size={15} />
        </button>
      </header>
      {error ? (
        <p className="gen2-superset-tool-error" role="alert">
          {error}
        </p>
      ) : null}
      {files.length ? (
        <ul className="gen2-superset-change-list" aria-label="Changed files">
          {files.map((file) => (
            <li key={file.path}>
              <code data-status={file.code}>{file.code}</code>
              <span>{file.path}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {diff.trim() ? (
        <pre className="gen2-superset-diff" aria-label="Working tree diff">
          {diff}
        </pre>
      ) : (
        <p className="gen2-superset-tool-empty">
          {files.length
            ? "New files have no diff until Git tracks them."
            : "Edit a file to inspect its diff here."}
        </p>
      )}
    </section>
  );
}

/**
 * Browser adaptation of Superset's workspace shell. The host owns terminal,
 * Git, and worktree operations; CoDev supplies member authorization and the
 * worktree-scoped Yjs editor beneath it.
 */
export function SupersetWorkspaceShell({
  workspaceId,
  canEdit,
  runtimeEnabled,
}: {
  workspaceId: string;
  canEdit: boolean;
  runtimeEnabled: boolean;
}) {
  const [tab, setTab] = useState<Tab>("files");
  const [worktrees, setWorktrees] = useState<Worktree[]>([
    { worktreeId: DEFAULT_SUPERSET_WORKTREE_ID, branch: "main" },
  ]);
  const [worktreeId, setWorktreeId] = useState(DEFAULT_SUPERSET_WORKTREE_ID);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newWorktreeId, setNewWorktreeId] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [baseRef, setBaseRef] = useState("");

  const refreshWorktrees = useCallback(async () => {
    if (!runtimeEnabled) return;
    try {
      const next = await listSupersetWorktrees(workspaceId);
      if (next.length) setWorktrees(next);
      setNotice("");
    } catch (error) {
      setNotice(errorMessage(error, "Couldn’t load worktrees."));
    }
  }, [runtimeEnabled, workspaceId]);

  useEffect(() => {
    // The request settles after mount and updates only its own worktree list.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshWorktrees();
  }, [refreshWorktrees]);

  function selectWorktree(next: string) {
    if (next === worktreeId) return true;
    if (
      dirty &&
      !window.confirm("Discard unsaved changes and switch branches?")
    )
      return false;
    setWorktreeId(next);
    setDirty(false);
    setNotice("");
    return true;
  }

  async function createWorktree(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newWorktreeId.trim() || !newBranch.trim() || creating) return;
    setCreating(true);
    try {
      const created = await createSupersetWorktree(workspaceId, {
        worktreeId: newWorktreeId.trim(),
        branch: newBranch.trim(),
        ...(baseRef.trim() ? { baseRef: baseRef.trim() } : {}),
      });
      setWorktrees((current) => [...current, created]);
      setShowCreate(false);
      setNewWorktreeId("");
      setNewBranch("");
      setBaseRef("");
      const selected = selectWorktree(created.worktreeId);
      setNotice(
        selected
          ? `Created and selected ${created.branch}.`
          : `Created ${created.branch}. Your current unsaved changes were preserved.`,
      );
    } catch (error) {
      setNotice(errorMessage(error, "Couldn’t create this worktree."));
    } finally {
      setCreating(false);
    }
  }

  if (!runtimeEnabled) {
    return (
      <>
        <p className="gen2-superset-runtime-notice" role="status">
          Superset terminal, Changes, and branch worktrees are disabled for this
          environment.
        </p>
        <SupersetFilePane workspaceId={workspaceId} canEdit={canEdit} />
      </>
    );
  }

  return (
    <main className="gen2-superset-workspace-shell">
      <header className="gen2-superset-workspace-header">
        <label>
          <span className="gen2-visually-hidden">Selected branch worktree</span>
          <select
            value={worktreeId}
            onChange={(event) => selectWorktree(event.target.value)}
          >
            {worktrees.map((worktree) => (
              <option key={worktree.worktreeId} value={worktree.worktreeId}>
                {worktree.branch}
              </option>
            ))}
          </select>
        </label>
        {canEdit ? (
          <button
            type="button"
            className="gen2-superset-worktree-create"
            onClick={() => setShowCreate((current) => !current)}
            aria-expanded={showCreate}
          >
            <Plus aria-hidden="true" size={15} /> New branch
          </button>
        ) : null}
        <div
          role="tablist"
          aria-label="Workspace panels"
          className="gen2-superset-workspace-tabs"
        >
          <button
            id="superset-tab-files"
            type="button"
            role="tab"
            aria-selected={tab === "files"}
            aria-controls="superset-panel-files"
            onClick={() => setTab("files")}
          >
            <Files aria-hidden="true" size={15} /> Files
          </button>
          <button
            id="superset-tab-changes"
            type="button"
            role="tab"
            aria-selected={tab === "changes"}
            aria-controls="superset-panel-changes"
            onClick={() => setTab("changes")}
          >
            <GitBranch aria-hidden="true" size={15} /> Changes
          </button>
          <button
            id="superset-tab-terminal"
            type="button"
            role="tab"
            aria-selected={tab === "terminal"}
            aria-controls="superset-panel-terminal"
            onClick={() => setTab("terminal")}
          >
            <SquareTerminal aria-hidden="true" size={15} /> Terminal
          </button>
        </div>
      </header>
      {showCreate ? (
        <form
          className="gen2-superset-worktree-form"
          onSubmit={(event) => void createWorktree(event)}
        >
          <label>
            Worktree ID
            <input
              value={newWorktreeId}
              onChange={(event) => setNewWorktreeId(event.target.value)}
              placeholder="feature-auth"
              required
            />
          </label>
          <label>
            Branch
            <input
              value={newBranch}
              onChange={(event) => setNewBranch(event.target.value)}
              placeholder="feature/auth"
              required
            />
          </label>
          <label>
            Base ref <span>(optional)</span>
            <input
              value={baseRef}
              onChange={(event) => setBaseRef(event.target.value)}
              placeholder="main"
            />
          </label>
          <button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create worktree"}
          </button>
        </form>
      ) : null}
      {notice ? (
        <p className="gen2-superset-runtime-notice" role="status">
          {notice}
        </p>
      ) : null}
      <div className="gen2-superset-workspace-content">
        <div
          id="superset-panel-files"
          role="tabpanel"
          aria-labelledby="superset-tab-files"
          hidden={tab !== "files"}
          className="gen2-superset-files-panel"
        >
          <SupersetFilePane
            key={worktreeId}
            workspaceId={workspaceId}
            canEdit={canEdit}
            worktreeId={worktreeId}
            onDirtyChange={setDirty}
          />
        </div>
        <SupersetChangesPane
          workspaceId={workspaceId}
          worktreeId={worktreeId}
          visible={tab === "changes"}
        />
        <section
          id="superset-panel-terminal"
          role="tabpanel"
          aria-labelledby="superset-tab-terminal"
          hidden={tab !== "terminal"}
          className="gen2-superset-tool-panel"
        >
          <Gen2TerminalPane
            key={worktreeId}
            workspaceId={workspaceId}
            worktreeId={worktreeId}
            visible={tab === "terminal"}
            canStart
            onExit={() => undefined}
          />
        </section>
      </div>
    </main>
  );
}

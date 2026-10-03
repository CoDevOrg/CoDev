"use client";

import { type FormEvent, useEffect, useState } from "react";
import type {
  Gen2SupersetAgentListItem,
  Gen2WorkspaceMember,
} from "@codev/contracts";
import { Bot, GitBranch, Plus, RotateCcw, Square } from "lucide-react";

import { cn } from "@/lib/platform/utils";

import { ProviderLogo } from "./provider-logos";
import { WorkspaceButton } from "./workspace-button";

type Progress = Record<string, string>;

function statusLabel(status: Gen2SupersetAgentListItem["status"]) {
  return status === "creating"
    ? "Starting"
    : status === "running"
      ? "Working"
      : status === "stopping"
        ? "Stopping"
        : status === "recovery_required"
          ? "Needs recovery"
          : status === "failed"
            ? "Failed"
            : "Finished";
}

function ownerName(
  run: Gen2SupersetAgentListItem,
  members: Gen2WorkspaceMember[],
) {
  const member = members.find(({ userId }) => userId === run.createdBy);
  return member?.name || member?.login || "Workspace member";
}

async function readProgress(
  workspaceId: string,
  run: Gen2SupersetAgentListItem,
) {
  const url = `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/superset/agents/${encodeURIComponent(run.id)}/progress`;
  const response = await fetch(
    url,
    run.canInput
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ after: 0 }),
        }
      : { method: "GET" },
  );
  if (!response.ok) return "";
  const payload = (await response.json()) as {
    chunks?: Array<{ text?: string }>;
  };
  return payload.chunks?.[0]?.text ?? "";
}

/** Safe shared agent status with controls granted by the server. */
export function SupersetAgentRoster({
  workspaceId,
  runs,
  members,
  branches,
  canStart,
  provider,
  onSelectWorktree,
  onStart,
  onChanged,
}: {
  workspaceId: string;
  runs: Gen2SupersetAgentListItem[];
  members: Gen2WorkspaceMember[];
  branches: Record<string, string>;
  canStart: boolean;
  provider: "codex" | "claude";
  onSelectWorktree: (worktreeId: string) => void;
  onStart: (prompt: string, provider: "codex" | "claude") => Promise<void>;
  onChanged: () => void;
}) {
  const [progress, setProgress] = useState<Progress>({});
  const [pending, setPending] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startFormOpen, setStartFormOpen] = useState(false);
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const next = await Promise.all(
        runs.map(
          async (run) =>
            [run.id, await readProgress(workspaceId, run)] as const,
        ),
      );
      if (!cancelled) setProgress(Object.fromEntries(next));
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [runs, workspaceId]);

  async function control(
    run: Gen2SupersetAgentListItem,
    action: "cancel" | "recover",
  ) {
    setPending(run.id);
    try {
      const response = await fetch(
        `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/superset/agents/${encodeURIComponent(run.id)}${action === "recover" ? "/recovery" : ""}`,
        { method: action === "recover" ? "POST" : "DELETE" },
      );
      if (response.ok) onChanged();
    } finally {
      setPending(null);
    }
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim() || starting) return;
    setStarting(true);
    try {
      await onStart(prompt.trim(), provider);
      setPrompt("");
      setStartFormOpen(false);
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="gen2-agent-roster" aria-label="Workspace agents">
      <div className="gen2-sidebar-section-header">
        <span className="gen2-sidebar-section-title">AGENTS</span>
        <div className="flex items-center gap-1">
          <span className="gen2-sidebar-section-count">{runs.length}</span>
          {canStart ? (
            <WorkspaceButton
              size="icon"
              aria-label="Start agent"
              onClick={() => setStartFormOpen((open) => !open)}
            >
              <Plus aria-hidden="true" />
            </WorkspaceButton>
          ) : null}
        </div>
      </div>
      {startFormOpen ? (
        <form
          className="gen2-agent-roster-start"
          onSubmit={(event) => void start(event)}
        >
          <label htmlFor="superset-agent-prompt">New {provider} agent</label>
          <textarea
            id="superset-agent-prompt"
            value={prompt}
            maxLength={20_000}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe the task for this agent"
            required
          />
          <WorkspaceButton tone="primary" disabled={starting} type="submit">
            {starting ? "Starting…" : "Start agent"}
          </WorkspaceButton>
        </form>
      ) : null}
      {!runs.length ? (
        <p className="gen2-agent-roster-empty">No active agents</p>
      ) : null}
      <ul className="gen2-agent-roster-list">
        {runs.map((run) => {
          const branch = branches[run.worktreeId] ?? run.worktreeId;
          const isPending = pending === run.id;
          return (
            <li key={run.id} className="gen2-agent-roster-item">
              <div className="gen2-agent-roster-heading">
                <Bot size={15} aria-hidden="true" />
                <span>{ownerName(run, members)}</span>
                <span
                  className={cn("gen2-agent-roster-status", run.status)}
                  aria-label={`Status: ${statusLabel(run.status)}`}
                >
                  {statusLabel(run.status)}
                </span>
              </div>
              <div className="gen2-agent-roster-meta">
                <ProviderLogo provider={run.provider} size={14} />
                <span>{run.provider}</span>
                <span>·</span>
                <GitBranch size={13} aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => onSelectWorktree(run.worktreeId)}
                >
                  {branch}
                </button>
              </div>
              {progress[run.id] ? <pre>{progress[run.id]}</pre> : null}
              <div className="gen2-agent-roster-actions">
                <WorkspaceButton
                  size="toolbar"
                  onClick={() => onSelectWorktree(run.worktreeId)}
                >
                  Open branch
                </WorkspaceButton>
                {run.canCancel &&
                ["creating", "running", "stopping"].includes(run.status) ? (
                  <WorkspaceButton
                    tone="destructive"
                    size="toolbar"
                    disabled={isPending}
                    onClick={() => void control(run, "cancel")}
                  >
                    <Square data-icon="inline-start" aria-hidden="true" />
                    Stop
                  </WorkspaceButton>
                ) : null}
                {run.canRecover && run.status === "recovery_required" ? (
                  <WorkspaceButton
                    size="toolbar"
                    disabled={isPending}
                    onClick={() => void control(run, "recover")}
                  >
                    <RotateCcw data-icon="inline-start" aria-hidden="true" />
                    Recover
                  </WorkspaceButton>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

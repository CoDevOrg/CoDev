"use client";

import type { ReactNode } from "react";
import { LoaderCircle, SquareTerminal } from "lucide-react";

import { WorkspaceButton } from "./workspace-button";

export type SupersetAgentSession = {
  id: string;
  createdBy: string;
  worktreeId: string;
  provider: string;
  status: string;
  updatedAt: string;
};

export function SupersetAgentSessionsPanel({
  runs,
  canEdit,
  onSelect,
  onStop,
  stoppingRunId,
  renderOverlaps,
}: {
  runs: SupersetAgentSession[];
  canEdit: boolean;
  onSelect: (worktreeId: string) => void;
  onStop: (runId: string) => void;
  stoppingRunId: string | null;
  renderOverlaps?: (runId: string) => ReactNode;
}) {
  return (
    <section className="gen2-ide-agent-sessions" aria-label="Agent sessions">
      <div className="gen2-ide-agent-sessions-heading">Agent sessions</div>
      {runs.length === 0 ? (
        <p className="gen2-ide-agent-sessions-empty">
          Start a task from chat to create an isolated worktree.
        </p>
      ) : (
        <ul className="gen2-ide-agent-sessions-list">
          {runs.map((run) => (
            <li key={run.id} className="gen2-ide-agent-session-row">
              <WorkspaceButton
                className="gen2-ide-agent-session-select"
                onClick={() => onSelect(run.worktreeId)}
              >
                <SquareTerminal aria-hidden="true" />
                <span>{run.worktreeId}</span>
                <span>
                  {run.provider} · {run.status}
                </span>
              </WorkspaceButton>
              {renderOverlaps?.(run.id)}
              {canEdit &&
              ["creating", "running", "stopping"].includes(run.status) ? (
                <WorkspaceButton
                  tone="destructive"
                  size="icon"
                  aria-label={`Stop ${run.worktreeId}`}
                  disabled={stoppingRunId === run.id}
                  onClick={() => onStop(run.id)}
                >
                  {stoppingRunId === run.id ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <SquareTerminal />
                  )}
                </WorkspaceButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

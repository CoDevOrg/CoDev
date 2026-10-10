"use client";

import type { ReactNode } from "react";
import { LoaderCircle, Square } from "lucide-react";

import { ProviderLogo } from "./provider-logos";
import { WorkspaceButton } from "./workspace-button";

export type SupersetAgentSession = {
  id: string;
  chatId?: string | null | undefined;
  createdBy: string;
  worktreeId: string;
  provider: string;
  status: string;
  updatedAt: string;
};

/** Runs store the credential's vendor; the strip speaks in agents. */
const AGENTS: Record<string, { id: string; label: string }> = {
  openai: { id: "codex", label: "Codex" },
  codex: { id: "codex", label: "Codex" },
  anthropic: { id: "claude", label: "Claude" },
  claude: { id: "claude", label: "Claude" },
  cursor: { id: "cursor", label: "Cursor" },
};

const STATUS: Record<string, string> = {
  creating: "Starting",
  running: "Working",
  stopping: "Stopping",
  recovery_required: "Needs attention",
};

/**
 * Agents working in this workspace's other chats, so a member sees what else
 * is changing and can jump to it. Finished runs and the open chat's own run
 * are left out: the board keeps history, and the chat shows its own turn.
 */
export function SupersetAgentSessionsPanel({
  runs,
  chatTitle,
  branchFor,
  currentChatId,
  canEdit,
  onOpen,
  onStop,
  stoppingRunId,
  renderOverlaps,
}: {
  runs: SupersetAgentSession[];
  chatTitle: (chatId: string) => string | null;
  branchFor: (worktreeId: string) => string;
  currentChatId: string | null;
  canEdit: boolean;
  onOpen: (run: SupersetAgentSession) => void;
  onStop: (runId: string) => void;
  stoppingRunId: string | null;
  renderOverlaps?: (runId: string) => ReactNode;
}) {
  const others = runs.filter(
    (run) =>
      run.status in STATUS && (!run.chatId || run.chatId !== currentChatId),
  );
  if (others.length === 0) return null;
  return (
    <section
      className="gen2-ide-agent-sessions"
      aria-label="Agents working in other chats"
    >
      <ul className="gen2-ide-agent-sessions-list">
        {others.map((run) => {
          const agent = AGENTS[run.provider];
          const title = (run.chatId && chatTitle(run.chatId)) || "Agent";
          const branch = branchFor(run.worktreeId);
          return (
            <li key={run.id} className="gen2-ide-agent-session-row">
              <WorkspaceButton
                className="gen2-ide-agent-session-select"
                aria-label={`${agent?.label ?? "Agent"} working on ${title} in ${branch}. Open it.`}
                onClick={() => onOpen(run)}
              >
                {agent ? (
                  <ProviderLogo provider={agent.id} size={14} aria-hidden />
                ) : null}
                <span className="gen2-ide-agent-session-title">{title}</span>
                <span className="gen2-ide-agent-session-branch">{branch}</span>
                <span
                  className="gen2-ide-agent-session-status"
                  data-status={run.status}
                >
                  {STATUS[run.status]}
                </span>
              </WorkspaceButton>
              {renderOverlaps?.(run.id)}
              {canEdit && run.status !== "recovery_required" ? (
                <WorkspaceButton
                  size="icon"
                  aria-label={`Stop the agent on ${title}`}
                  disabled={stoppingRunId === run.id}
                  onClick={() => onStop(run.id)}
                >
                  {stoppingRunId === run.id ? (
                    <LoaderCircle className="gen2-loading-mark" aria-hidden />
                  ) : (
                    <Square aria-hidden />
                  )}
                </WorkspaceButton>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

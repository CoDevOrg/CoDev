"use client";

import { Activity, Bot, GitBranch, Users } from "lucide-react";

import type { CollaborationUser } from "@/lib/collaboration-client";
import type { AgentSession } from "@/components/agent-panel";

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting"]);

function collaboratorName(member: CollaborationUser) {
  return member.name ?? member.login;
}

export function TeamStatsPanel({
  sessions,
  collaborators,
  currentUser,
  peopleHere,
}: {
  sessions: AgentSession[];
  collaborators: CollaborationUser[];
  currentUser: { id: string; name?: string | null; login?: string };
  peopleHere: number;
}) {
  const activeAgents = sessions.filter((session) =>
    ACTIVE_STATUSES.has(session.status),
  ).length;
  const completedSessions = sessions.filter(
    (session) =>
      session.status === "completed" || session.worktreeStatus === "merged",
  ).length;
  const modelCount = new Set(sessions.map((session) => session.model)).size;
  const people = [
    {
      id: currentUser.id,
      name: currentUser.name ?? currentUser.login ?? "You",
      detail: "Workspace owner",
    },
    ...collaborators
      .filter((member) => member.id !== currentUser.id)
      .map((member) => ({
        id: member.id,
        name: collaboratorName(member),
        detail: member.activePath ? `Editing ${member.activePath}` : "Online",
      })),
  ];

  return (
    <section className="team-stats-panel" aria-label="Team stats">
      <header className="team-stats-header">
        <div>
          <span className="team-stats-eyebrow">Workspace overview</span>
          <h1>Team Stats</h1>
          <p>See who is here and how your agents are being used.</p>
        </div>
        <div className="team-stats-live-status">
          <i /> Live workspace data
        </div>
      </header>

      <div className="team-stats-cards">
        <article className="team-stat-card">
          <span className="team-stat-icon">
            <Users aria-hidden="true" />
          </span>
          <div>
            <small>People here</small>
            <strong>{peopleHere}</strong>
            <span>Realtime collaborators</span>
          </div>
        </article>
        <article className="team-stat-card">
          <span className="team-stat-icon">
            <Bot aria-hidden="true" />
          </span>
          <div>
            <small>Active agents</small>
            <strong>{activeAgents}</strong>
            <span>{sessions.length} sessions in this workspace</span>
          </div>
        </article>
        <article className="team-stat-card">
          <span className="team-stat-icon">
            <Activity aria-hidden="true" />
          </span>
          <div>
            <small>Completed sessions</small>
            <strong>{completedSessions}</strong>
            <span>{modelCount} model selections</span>
          </div>
        </article>
      </div>

      <div className="team-stats-lower-grid">
        <section className="team-stats-section">
          <div className="team-stats-section-heading">
            <div>
              <span className="team-stats-eyebrow">Presence</span>
              <h2>People in this workspace</h2>
            </div>
            <Users aria-hidden="true" />
          </div>
          <div className="team-people-list">
            {people.map((person) => (
              <div className="team-person" key={person.id}>
                <span className="team-person-avatar">
                  {person.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{person.name}</strong>
                  <small>{person.detail}</small>
                </span>
                <i />
              </div>
            ))}
          </div>
        </section>

        <section className="team-stats-section">
          <div className="team-stats-section-heading">
            <div>
              <span className="team-stats-eyebrow">Agent activity</span>
              <h2>Recent worktrees</h2>
            </div>
            <GitBranch aria-hidden="true" />
          </div>
          <div className="team-worktree-list">
            {sessions.length ? (
              sessions
                .slice(-5)
                .reverse()
                .map((session) => (
                  <div className="team-worktree" key={session.id}>
                    <span>
                      <strong>{session.name}</strong>
                      <small>{session.model}</small>
                    </span>
                    <b>{session.status}</b>
                  </div>
                ))
            ) : (
              <p className="team-stats-empty">No agent sessions yet.</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

"use client";

import { useMemo } from "react";

import type { CollaborationUser } from "@/lib/collaboration-client";
import type { AgentSession } from "@/components/agent-panel";
import type { WorkspaceShareMember } from "@/components/share-dialog";
import {
  buildTeamStatsSnapshot,
  formatPercent,
  TEAM_STATS_VM_QUOTA,
} from "@/lib/team-stats";

type RuntimeStatus =
  | "provisioning"
  | "ready"
  | "hibernated"
  | "stopping"
  | "stopped"
  | "failed";

function runtimeLabel(status: RuntimeStatus) {
  switch (status) {
    case "ready":
      return "Sandbox ready";
    case "provisioning":
      return "Provisioning sandbox";
    case "hibernated":
      return "Sandbox hibernated";
    case "stopping":
      return "Stopping sandbox";
    case "failed":
      return "Sandbox failed";
    default:
      return "Sandbox stopped";
  }
}

function statusTone(status: string) {
  if (status === "running" || status === "queued" || status === "waiting") {
    return "is-active";
  }
  if (status === "failed") return "is-failed";
  if (status === "completed" || status === "merged") return "is-done";
  return "is-idle";
}

export function TeamStatsPanel({
  sessions,
  collaborators,
  members,
  currentUser,
  peopleHere,
  runtimeStatus,
  repository,
  branch,
  vmMinutesUsed,
  vmMinutesQuota = TEAM_STATS_VM_QUOTA,
}: {
  sessions: AgentSession[];
  collaborators: CollaborationUser[];
  members: WorkspaceShareMember[];
  currentUser: { id: string; name?: string | null; login?: string };
  peopleHere: number;
  runtimeStatus: RuntimeStatus;
  repository: string;
  branch: string;
  vmMinutesUsed: number;
  vmMinutesQuota?: number | undefined;
}) {
  const stats = useMemo(
    () =>
      buildTeamStatsSnapshot({
        sessions,
        collaborators,
        members,
        currentUser,
        peopleOnline: peopleHere,
      }),
    [sessions, collaborators, members, currentUser, peopleHere],
  );

  const vmRemaining = Math.max(0, vmMinutesQuota - vmMinutesUsed);
  const vmShare =
    vmMinutesQuota > 0
      ? Math.min(1, Math.max(0, vmMinutesUsed / vmMinutesQuota))
      : 0;
  const repoLabel = repository || "Untitled workspace";

  return (
    <section className="team-stats-panel" aria-label="Team stats">
      <header className="team-stats-header">
        <div>
          <span className="team-stats-eyebrow">Workspace overview</span>
          <h1>Team Stats</h1>
          <p>
            Presence, agent throughput, worktree outcomes, and sandbox compute
            for this workspace.
          </p>
          <div className="team-stats-meta">
            <span>{repoLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{branch || "main"}</span>
          </div>
        </div>
        <div className="team-stats-header-aside">
          <div
            className={`team-stats-live-status runtime-${runtimeStatus}`}
            title={runtimeLabel(runtimeStatus)}
          >
            <i />
            {runtimeLabel(runtimeStatus)}
          </div>
          <div className="team-stats-live-status">
            <i />
            {stats.peopleOnline} online now
          </div>
        </div>
      </header>

      <div className="team-stats-metrics" role="list">
        <div className="team-stats-metric" role="listitem">
          <small>Online</small>
          <strong>{stats.peopleOnline}</strong>
          <span>
            of {stats.memberCount} member{stats.memberCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="team-stats-metric" role="listitem">
          <small>Active agents</small>
          <strong>{stats.activeAgents}</strong>
          <span>
            {stats.sessionCount} session{stats.sessionCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="team-stats-metric" role="listitem">
          <small>Turns</small>
          <strong>{stats.turnCount}</strong>
          <span>{stats.failedSessions} with errors</span>
        </div>
        <div className="team-stats-metric" role="listitem">
          <small>Open worktrees</small>
          <strong>{stats.openWorktrees}</strong>
          <span>
            {stats.mergedWorktrees} merged · {stats.discardedWorktrees}{" "}
            discarded
          </span>
        </div>
        <div className="team-stats-metric" role="listitem">
          <small>Reviews</small>
          <strong>{stats.reviewedSessions}</strong>
          <span>
            {stats.openClaims} active claim{stats.openClaims === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="team-stats-mid-grid">
        <section className="team-stats-section">
          <div className="team-stats-section-heading">
            <div>
              <span className="team-stats-eyebrow">Compute</span>
              <h2>Sandbox VM minutes</h2>
            </div>
            <span className="team-stats-section-note">Owner allotment</span>
          </div>
          <div className="team-stats-vm">
            <div className="team-stats-vm-numbers">
              <strong>
                {vmMinutesUsed.toLocaleString()}
                <span> / {vmMinutesQuota.toLocaleString()}</span>
              </strong>
              <small>{vmRemaining.toLocaleString()} minutes remaining</small>
            </div>
            <div
              className="team-stats-meter"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={vmMinutesQuota}
              aria-valuenow={vmMinutesUsed}
              aria-label="Lifetime VM minutes used"
            >
              <b style={{ width: `${Math.round(vmShare * 100)}%` }} />
            </div>
            <p className="team-stats-copy">
              Firecracker sandbox runtime is billed against the workspace
              owner&apos;s lifetime minutes. Model tokens bill to each
              author&apos;s Codex, Claude, or Cursor credentials.
            </p>
          </div>
        </section>

        <section className="team-stats-section">
          <div className="team-stats-section-heading">
            <div>
              <span className="team-stats-eyebrow">Agent mix</span>
              <h2>Providers and models</h2>
            </div>
          </div>
          {stats.sessionCount === 0 ? (
            <p className="team-stats-empty">
              No agent sessions yet. Start one from Agent Console.
            </p>
          ) : (
            <div className="team-stats-mix">
              <div>
                <h3>By provider</h3>
                <ul className="team-stats-bars">
                  {stats.providers.map((bucket) => (
                    <li key={bucket.key}>
                      <div>
                        <strong>{bucket.label}</strong>
                        <span>
                          {bucket.count} · {formatPercent(bucket.share)}
                        </span>
                      </div>
                      <div className="team-stats-meter">
                        <b
                          style={{
                            width: `${Math.round(bucket.share * 100)}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>By model</h3>
                <ul className="team-stats-bars">
                  {stats.models.map((bucket) => (
                    <li key={bucket.key}>
                      <div>
                        <strong title={bucket.label}>{bucket.label}</strong>
                        <span>
                          {bucket.count} · {formatPercent(bucket.share)}
                        </span>
                      </div>
                      <div className="team-stats-meter">
                        <b
                          style={{
                            width: `${Math.round(bucket.share * 100)}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>By status</h3>
                <ul className="team-stats-chip-row">
                  {stats.statuses.map((bucket) => (
                    <li key={bucket.key} className={statusTone(bucket.key)}>
                      <strong>{bucket.count}</strong>
                      <span>{bucket.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="team-stats-section team-stats-sessions">
        <div className="team-stats-section-heading">
          <div>
            <span className="team-stats-eyebrow">Sessions</span>
            <h2>Recent agent work</h2>
          </div>
          <span className="team-stats-section-note">
            {stats.sessionCount} total
          </span>
        </div>
        {stats.recentSessions.length === 0 ? (
          <p className="team-stats-empty">
            No agent activity in this workspace.
          </p>
        ) : (
          <div className="team-stats-table-wrap">
            <table className="team-stats-table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Status</th>
                  <th>Worktree</th>
                  <th>Turns</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentSessions.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      {row.lastPrompt ? (
                        <small title={row.lastPrompt}>{row.lastPrompt}</small>
                      ) : row.lastError ? (
                        <small className="is-error" title={row.lastError}>
                          {row.lastError}
                        </small>
                      ) : null}
                    </td>
                    <td>{row.provider}</td>
                    <td>
                      <code>{row.model}</code>
                    </td>
                    <td>
                      <b
                        className={`team-stats-pill ${statusTone(row.status)}`}
                      >
                        {row.status}
                      </b>
                    </td>
                    <td>
                      <span className="team-stats-worktree">
                        {row.worktreeStatus}
                        {row.hasReview ? " · reviewed" : ""}
                      </span>
                    </td>
                    <td>{row.turnCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="team-stats-lower-grid">
        <section className="team-stats-section">
          <div className="team-stats-section-heading">
            <div>
              <span className="team-stats-eyebrow">Team</span>
              <h2>People with access</h2>
            </div>
            <span className="team-stats-section-note">
              {stats.people.filter((person) => person.online).length} online
            </span>
          </div>
          <div className="team-people-list">
            {stats.people.map((person) => (
              <div
                className={`team-person ${person.online ? "is-online" : "is-offline"}`}
                key={person.id}
              >
                <span className="team-person-avatar" aria-hidden="true">
                  {person.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>
                    {person.name}
                    {person.isYou ? " (you)" : ""}
                  </strong>
                  <small>
                    {person.roleLabel} · {person.detail}
                  </small>
                </span>
                <i aria-label={person.online ? "Online" : "Offline"} />
              </div>
            ))}
          </div>
        </section>

        <section className="team-stats-section">
          <div className="team-stats-section-heading">
            <div>
              <span className="team-stats-eyebrow">Coordination</span>
              <h2>Active path claims</h2>
            </div>
          </div>
          {stats.coordination.length === 0 ? (
            <p className="team-stats-empty">
              No active file claims. Agents claim paths when they start editing
              overlapping areas.
            </p>
          ) : (
            <div className="team-worktree-list">
              {stats.coordination.map((claim) => (
                <div className="team-worktree" key={claim.id}>
                  <span>
                    <strong>{claim.pathGlob}</strong>
                    <small>
                      {claim.sessionName} · {claim.intent}
                    </small>
                  </span>
                  <b className="team-stats-pill is-active">{claim.status}</b>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

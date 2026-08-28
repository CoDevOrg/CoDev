"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  AGENT_PHASE_LABEL,
  BRAIN_ENTRY_LABEL,
  OVERLAP_KIND_LABEL,
  agentDiffTotals,
  elapsedLabel,
  memberById,
  relativeLabel,
  type MissionControlAgent,
  type MissionControlMember,
  type MissionControlSnapshot,
} from "@/lib/mission-control-model";

function Avatar({
  member,
  size = 26,
  title,
}: {
  member: MissionControlMember;
  size?: number;
  title?: string;
}) {
  return (
    <span
      className="mc-avatar"
      title={title ?? member.name}
      aria-label={title ?? member.name}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(150deg, hsl(${member.hue} 62% 46%), hsl(${member.hue} 54% 32%))`,
      }}
    >
      {member.initials}
    </span>
  );
}

function PhasePill({ agent }: { agent: MissionControlAgent }) {
  return (
    <span className={`mc-phase mc-phase-${agent.phase}`}>
      <i className="mc-phase-dot" aria-hidden />
      {AGENT_PHASE_LABEL[agent.phase]}
    </span>
  );
}

function ProviderMark({ provider }: { provider: "claude" | "codex" }) {
  return (
    <span className={`mc-provider mc-provider-${provider}`}>
      {provider === "claude" ? "Claude" : "Codex"}
    </span>
  );
}

function AgentCard({
  agent,
  snapshot,
  now,
  active,
  onOpen,
}: {
  agent: MissionControlAgent;
  snapshot: MissionControlSnapshot;
  now: number;
  active: boolean;
  onOpen: () => void;
}) {
  const owner = memberById(snapshot, agent.ownerId);
  const diff = agentDiffTotals(agent);
  const blocker = agent.blockedBy
    ? snapshot.agents.find(
        (candidate) => candidate.id === agent.blockedBy?.agentId,
      )
    : undefined;
  const blockerOwner = memberById(snapshot, blocker?.ownerId);
  const done = agent.plan.filter((step) => step.state === "done").length;

  return (
    <article
      className={`mc-card mc-card-${agent.phase}${active ? " is-active" : ""}`}
    >
      <header className="mc-card-head">
        <div className="mc-card-who">
          {owner ? (
            <Avatar member={owner} title={`Started by ${owner.name}`} />
          ) : null}
          <div>
            <p className="mc-card-owner">{owner?.name ?? "Unassigned"}</p>
            <p className="mc-card-branch">{agent.branch}</p>
          </div>
        </div>
        <PhasePill agent={agent} />
      </header>

      <h3 className="mc-card-title">{agent.title}</h3>

      {agent.brief?.goal ? (
        <p
          className="mc-card-goal"
          title="Goal the agent posted to the workspace brain"
        >
          <i className="mc-brain-mark" aria-hidden>
            ◈
          </i>{" "}
          {agent.brief.goal}
        </p>
      ) : null}

      <p
        className={`mc-activity${agent.phase === "blocked" ? " is-blocked" : ""}`}
      >
        <i className="mc-activity-caret" aria-hidden />
        <span key={agent.activity} className="mc-activity-text">
          {agent.activity}
        </span>
      </p>

      {agent.blockedBy ? (
        <p className="mc-blocked-note">
          <code>{agent.blockedBy.path}</code> is claimed by{" "}
          {blockerOwner?.name ?? "another agent"}&rsquo;s agent — CoDev is
          holding the write so the two cannot collide.
        </p>
      ) : null}

      <div className="mc-progress" aria-hidden>
        {agent.plan.map((step, index) => (
          <span key={index} className={`mc-progress-seg is-${step.state}`} />
        ))}
      </div>
      <p className="mc-progress-label">
        Step {Math.min(done + 1, agent.plan.length)} of {agent.plan.length} ·{" "}
        {agent.plan.find((step) => step.state === "active")?.label ??
          agent.plan[agent.plan.length - 1]?.label}
      </p>

      <dl className="mc-stats">
        <div>
          <dt>Runtime</dt>
          <dd>{elapsedLabel(agent.startedAt, now)}</dd>
        </div>
        <div>
          <dt>Diff</dt>
          <dd className="mc-diff">
            <span className="mc-add">+{diff.added}</span>
            <span className="mc-rem">−{diff.removed}</span>
          </dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd>{agent.files.length}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd className="mc-model">
            <ProviderMark provider={agent.provider} />
          </dd>
        </div>
      </dl>

      <footer className="mc-card-foot">
        <div className="mc-watchers">
          {agent.watcherIds.length > 0 ? (
            <>
              {agent.watcherIds.map((id) => {
                const watcher = memberById(snapshot, id);
                return watcher ? (
                  <Avatar
                    key={id}
                    member={watcher}
                    size={20}
                    title={`${watcher.name} is watching`}
                  />
                ) : null;
              })}
              <span className="mc-watchers-label">watching</span>
            </>
          ) : (
            <span className="mc-watchers-label">No one watching</span>
          )}
        </div>
        <button className="mc-step-in" type="button" onClick={onOpen}>
          Step in
        </button>
      </footer>
    </article>
  );
}

const QUICK_STEERS = [
  "Add a test for that case",
  "Wrong approach — revert",
  "Explain your reasoning",
  "Ship it",
];

function AgentDrawer({
  agent,
  snapshot,
  now,
  viewerId,
  onClose,
  onSteer,
  onInterrupt,
}: {
  agent: MissionControlAgent;
  snapshot: MissionControlSnapshot;
  now: number;
  viewerId: string;
  onClose: () => void;
  onSteer: (text: string) => void;
  onInterrupt: () => void;
}) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const owner = memberById(snapshot, agent.ownerId);
  const diff = agentDiffTotals(agent);

  useEffect(() => {
    const node = logRef.current;
    if (!node) return;
    // Scroll after paint: on the tick that appends a line, the new row has not
    // been laid out yet when the effect runs, so reading scrollHeight here
    // lands one row short and clips the newest entry.
    const frame = requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [agent.log.length]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSteer(text);
    setDraft("");
  }

  return (
    <>
      <div className="mc-scrim" onClick={onClose} aria-hidden />
      <aside
        className="mc-drawer"
        aria-label={`Agent detail: ${agent.title}`}
        role="dialog"
        aria-modal="true"
      >
        <header className="mc-drawer-head">
          <div>
            <p className="mc-drawer-kicker">
              {owner?.name ?? "Unassigned"} · {agent.branch}
            </p>
            <h2>{agent.title}</h2>
          </div>
          <button
            className="mc-drawer-close"
            type="button"
            onClick={onClose}
            aria-label="Close agent detail"
          >
            ✕
          </button>
        </header>

        <div className="mc-drawer-strip">
          <PhasePill agent={agent} />
          <ProviderMark provider={agent.provider} />
          <span className="mc-chip">{agent.model}</span>
          <span className="mc-chip">{elapsedLabel(agent.startedAt, now)}</span>
          <span className="mc-chip">
            {agent.tokens.toLocaleString()} tokens
          </span>
        </div>

        <section className="mc-drawer-section">
          <h4>Plan</h4>
          <ol className="mc-plan">
            {agent.plan.map((step, index) => (
              <li key={index} className={`is-${step.state}`}>
                <span className="mc-plan-mark" aria-hidden />
                {step.label}
              </li>
            ))}
          </ol>
        </section>

        <section className="mc-drawer-section">
          <h4>
            Files{" "}
            <span className="mc-diff">
              <span className="mc-add">+{diff.added}</span>
              <span className="mc-rem">−{diff.removed}</span>
            </span>
          </h4>
          <ul className="mc-files">
            {agent.files.map((file) => (
              <li key={file.path}>
                <code>{file.path}</code>
                <span className="mc-file-right">
                  {file.claimed ? (
                    <span className="mc-claim" title="Write claim held">
                      claimed
                    </span>
                  ) : null}
                  <span className="mc-add">+{file.added}</span>
                  <span className="mc-rem">−{file.removed}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mc-drawer-section mc-drawer-log-section">
          <h4>Live activity</h4>
          <div className="mc-log" ref={logRef}>
            {agent.log.map((entry) => {
              const author = memberById(snapshot, entry.authorId);
              return (
                <p key={entry.id} className={`mc-log-line is-${entry.kind}`}>
                  <span className="mc-log-time">
                    {relativeLabel(entry.at, now)}
                  </span>
                  {author ? (
                    <span className="mc-log-author">
                      <Avatar member={author} size={16} />
                      {author.name}
                    </span>
                  ) : null}
                  <span className="mc-log-text">{entry.text}</span>
                </p>
              );
            })}
          </div>
        </section>

        <footer className="mc-steer">
          <div className="mc-quick">
            {QUICK_STEERS.map((text) => (
              <button
                key={text}
                type="button"
                className="mc-quick-chip"
                onClick={() => onSteer(text)}
              >
                {text}
              </button>
            ))}
          </div>
          <div className="mc-steer-row">
            <input
              className="mc-steer-input"
              placeholder={`Steer ${owner?.name.split(" ")[0] ?? "this"}'s agent…`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              aria-label="Steer this agent"
            />
            <button
              className="mc-steer-send"
              type="button"
              onClick={submit}
              disabled={!draft.trim()}
            >
              Steer
            </button>
            <button
              className="mc-steer-stop"
              type="button"
              onClick={onInterrupt}
            >
              Pause
            </button>
          </div>
          <p className="mc-steer-note">
            Sent as {memberById(snapshot, viewerId)?.name ?? "you"} — every
            instruction is attributed in the shared transcript.
          </p>
        </footer>
      </aside>
    </>
  );
}

export function AgentMissionControl({
  snapshot,
  viewerId,
  onSteer,
  onInterrupt,
}: {
  snapshot: MissionControlSnapshot;
  viewerId: string;
  onSteer: (agentId: string, text: string) => void;
  onInterrupt: (agentId: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const open = snapshot.agents.find((agent) => agent.id === openId) ?? null;
  const live = useMemo(
    () =>
      snapshot.agents.filter(
        (agent) => agent.phase !== "done" && agent.phase !== "waiting",
      ).length,
    [snapshot.agents],
  );
  const blocked = snapshot.agents.filter(
    (agent) => agent.phase === "blocked",
  ).length;
  const totals = snapshot.agents.reduce(
    (sum, agent) => {
      const diff = agentDiffTotals(agent);
      return {
        added: sum.added + diff.added,
        removed: sum.removed + diff.removed,
      };
    },
    { added: 0, removed: 0 },
  );

  return (
    <div className="mc-root">
      <header className="mc-head">
        <div className="mc-head-left">
          <p className="mc-kicker">
            <i className="mc-live-dot" aria-hidden />
            Live in {snapshot.workspace}
          </p>
          <h1>Mission Control</h1>
          <p className="mc-sub">{snapshot.repository}</p>
        </div>
        <div className="mc-head-right">
          <div className="mc-metric">
            <strong>
              {live}
              <span>/{snapshot.maxAgents}</span>
            </strong>
            <span className="mc-metric-label">agents live</span>
          </div>
          <div className="mc-metric">
            <strong>{snapshot.members.length}</strong>
            <span className="mc-metric-label">people steering</span>
          </div>
          <div className="mc-metric">
            <strong className="mc-diff">
              <span className="mc-add">+{totals.added}</span>
              <span className="mc-rem">−{totals.removed}</span>
            </strong>
            <span className="mc-metric-label">this session</span>
          </div>
          {blocked > 0 ? (
            <div className="mc-metric is-warn">
              <strong>{blocked}</strong>
              <span className="mc-metric-label">claim conflict</span>
            </div>
          ) : null}
          <div className="mc-presence">
            {snapshot.members.map((member) => (
              <Avatar
                key={member.id}
                member={member}
                size={30}
                title={`${member.name} is in this workspace`}
              />
            ))}
          </div>
        </div>
      </header>

      {snapshot.overlaps.length > 0 ? (
        <section
          className="mc-overlaps"
          aria-label="Workspace brain overlap warnings"
        >
          <p className="mc-overlaps-head">
            <i className="mc-brain-mark" aria-hidden>
              ◈
            </i>{" "}
            The workspace brain sees agents converging
          </p>
          <ul>
            {snapshot.overlaps.map((overlap) => {
              const left = snapshot.agents.find(
                (agent) => agent.id === overlap.leftAgentId,
              );
              const right = snapshot.agents.find(
                (agent) => agent.id === overlap.rightAgentId,
              );
              const leftName =
                memberById(snapshot, left?.ownerId)?.name ?? "an agent";
              const rightName =
                memberById(snapshot, right?.ownerId)?.name ?? "an agent";
              return (
                <li key={overlap.id} className="mc-blocked-note">
                  <span className="mc-chip">
                    {OVERLAP_KIND_LABEL[overlap.kind]}
                  </span>{" "}
                  {leftName}&rsquo;s and {rightName}&rsquo;s agents —{" "}
                  {overlap.rationale} They should coordinate before this becomes
                  a merge conflict.
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="mc-grid">
        {snapshot.agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            snapshot={snapshot}
            now={now}
            active={agent.id === openId}
            onOpen={() => setOpenId(agent.id)}
          />
        ))}
      </div>

      {snapshot.history.length > 0 ? (
        <section
          className="mc-brain-history"
          aria-label="Workspace brain history"
        >
          <p className="mc-sub">
            Workspace brain · what has been tried and decided
          </p>
          <ul>
            {snapshot.history.slice(0, 8).map((entry) => (
              <li key={entry.id}>
                <span className="mc-chip">{BRAIN_ENTRY_LABEL[entry.kind]}</span>{" "}
                {entry.title}
                <span className="mc-log-time">
                  {" "}
                  {entry.authorName ? `${entry.authorName} · ` : ""}
                  {relativeLabel(entry.at, now)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {open ? (
        <AgentDrawer
          agent={open}
          snapshot={snapshot}
          now={now}
          viewerId={viewerId}
          onClose={() => setOpenId(null)}
          onSteer={(text) => onSteer(open.id, text)}
          onInterrupt={() => onInterrupt(open.id)}
        />
      ) : null}
    </div>
  );
}

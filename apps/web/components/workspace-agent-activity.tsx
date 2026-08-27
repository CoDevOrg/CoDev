"use client";

import { useEffect, useState } from "react";

import {
  LIVE_AGENT_ACTIVITY_POLL_MS,
  emptyLiveAgentCards,
  fetchLiveAgentActivity,
  type LiveAgentActivityCard,
  type LiveAgentActivitySnapshot,
} from "@/lib/live-agent-activity-view";

export function useLiveAgentActivity(workspaceId: string) {
  const [activity, setActivity] = useState<LiveAgentActivitySnapshot | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const next = await fetchLiveAgentActivity(workspaceId);
        if (!cancelled) setActivity(next);
      } catch {
        // Keep the last successful snapshot visible.
      }
    }

    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, LIVE_AGENT_ACTIVITY_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [workspaceId]);

  return activity;
}

export function WorkspaceAgentActivityRail({
  cards = emptyLiveAgentCards(),
  occupied = 0,
  max = 3,
}: {
  cards?: LiveAgentActivityCard[];
  occupied?: number;
  max?: number;
}) {
  return (
    <aside className="workspace-agent-activity" aria-label="Active agents">
      <header className="workspace-agent-activity-header">
        <div>
          <p className="workspace-agent-activity-kicker">Live in this room</p>
          <h2>Active agents</h2>
        </div>
        <span
          className="workspace-agent-activity-count"
          aria-label={`Active agents: ${occupied} of ${max} live`}
        >
          {occupied} of {max} live
        </span>
      </header>
      <div className="workspace-agent-activity-list">
        {cards.map((card) => (
          <article
            key={card.slot}
            className={[
              "workspace-agent-card",
              card.occupied ? "is-occupied" : "",
              card.status === "Running" ? "is-running" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label={
              card.occupied
                ? `Agent slot ${card.slot}: ${card.assignment}. Started by ${card.owner}. Working: ${card.working.join(", ") || "waiting for an instruction"}.`
                : `Agent slot ${card.slot}: available`
            }
          >
            <div className="workspace-agent-card-meta">
              <span>Slot 0{card.slot}</span>
              <strong className="workspace-agent-card-status">
                {card.status}
              </strong>
            </div>
            <h3>{card.occupied ? card.assignment : "No active agent"}</h3>
            {card.occupied ? (
              <dl className="workspace-agent-card-facts">
                <div>
                  <dt>Started by</dt>
                  <dd>{card.owner}</dd>
                </div>
                <div>
                  <dt>Working</dt>
                  <dd>
                    {card.working.length > 0
                      ? card.working.join(", ")
                      : "Waiting for an instruction"}
                  </dd>
                </div>
                <div>
                  <dt>Now</dt>
                  <dd>{card.currentTask}</dd>
                </div>
                <div>
                  <dt>Runtime</dt>
                  <dd>
                    {card.elapsed} · {card.provider}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="workspace-agent-card-empty">
                This slot is free. Start a session to fill it.
              </p>
            )}
          </article>
        ))}
      </div>
    </aside>
  );
}

"use client";

import { useEffect, useState } from "react";

import {
  LIVE_AGENT_ACTIVITY_POLL_MS,
  fetchLiveAgentActivity,
  type LiveAgentActivitySnapshot,
} from "@/lib/agents/live-agent-activity-view";

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

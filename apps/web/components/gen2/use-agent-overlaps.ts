"use client";

import {
  gen2AgentOverlapListResponseSchema,
  type Gen2AgentOverlap,
} from "@codev/contracts";
import { useEffect, useState } from "react";

const REFRESH_MS = 15_000;

/**
 * Overlaps between active agent sessions. It asks only while the workspace is
 * connected and two or more worktrees have active agent work, so it never
 * wakes a machine or keeps an idle one awake. Unknown data clears the list
 * rather than claiming there is no overlap.
 */
export function useAgentOverlaps(workspaceId: string, active: boolean) {
  const [overlaps, setOverlaps] = useState<Gen2AgentOverlap[]>([]);

  useEffect(() => {
    if (!active) {
      const timeout = setTimeout(() => setOverlaps([]), 0);
      return () => clearTimeout(timeout);
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/superset/overlaps`,
        );
        const parsed = gen2AgentOverlapListResponseSchema.safeParse(
          response.ok ? await response.json() : undefined,
        );
        if (!cancelled) setOverlaps(parsed.success ? parsed.data.overlaps : []);
      } catch {
        if (!cancelled) setOverlaps([]);
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active, workspaceId]);

  return overlaps;
}

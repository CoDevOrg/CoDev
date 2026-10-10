"use client";

import { useEffect, useState } from "react";

import { useRealtimeEvent } from "./use-workspace-realtime";

const PULSE_MS = 4_000;

/** Files an agent just changed in `worktreeId`, for a brief highlight. */
export function useAgentFilePulses(worktreeId: string) {
  const [pulses, setPulses] = useState<Map<string, number>>(new Map());
  useRealtimeEvent("files.changed", (event) => {
    if (event.actor.kind !== "agent" || event.worktreeId !== worktreeId) return;
    const until = Date.now() + PULSE_MS;
    setPulses((current) => {
      const next = new Map(current);
      for (const path of event.paths) next.set(path, until);
      return next;
    });
  });
  useEffect(() => {
    if (!pulses.size) return;
    const timer = window.setTimeout(
      () =>
        setPulses(
          (current) =>
            new Map([...current].filter(([, until]) => until > Date.now())),
        ),
      PULSE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [pulses]);
  return pulses;
}

"use client";

import { useEffect, useRef } from "react";
import type { Gen2RealtimeActor } from "@codev/contracts";

import { useRealtimeEvent } from "./use-workspace-realtime";

/**
 * Calls `handler` once per burst of pushed file changes. `worktreeId` limits
 * it to one worktree; null hears every worktree. Paths and actors from the
 * whole burst are passed together.
 */
export function useFilesChanged(
  worktreeId: string | null,
  delayMs: number,
  handler: (paths: string[], actors: Gen2RealtimeActor[]) => void,
) {
  const handlerRef = useRef(handler);
  const pending = useRef<{ paths: Set<string>; actors: Gen2RealtimeActor[] }>({
    paths: new Set(),
    actors: [],
  });
  const timer = useRef<number | null>(null);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  useRealtimeEvent("files.changed", (event) => {
    if (worktreeId !== null && event.worktreeId !== worktreeId) return;
    event.paths.forEach((path) => pending.current.paths.add(path));
    pending.current.actors.push(event.actor);
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const { paths, actors } = pending.current;
      pending.current = { paths: new Set(), actors: [] };
      handlerRef.current([...paths], actors);
    }, delayMs);
  });
}

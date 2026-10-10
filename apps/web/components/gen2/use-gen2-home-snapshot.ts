"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Gen2HomeSnapshot } from "@codev/contracts";

import { isWorkspaceSettling } from "@/components/gen2/workspace-phase";

const SETTLING_POLL_MS = 4_000;
const IDLE_POLL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Focus and visibility often fire together; one request covers both. */
const MIN_REFRESH_GAP_MS = 2_000;

/**
 * Keeps the workspace home current without a reload: polls quickly while a
 * workspace is starting, stopping, or deleting, slowly otherwise, pauses in
 * background tabs, and catches up as soon as the tab is visible again.
 *
 * `update` applies a local change (a deletion the server accepted) and
 * discards any poll already in flight, so a stale response cannot undo it.
 */
export function useGen2HomeSnapshot(initial: Gen2HomeSnapshot) {
  const [snapshot, setSnapshot] = useState(initial);
  const [source, setSource] = useState(initial);
  const [signedOut, setSignedOut] = useState(false);
  const sequence = useRef(0);
  const lastStarted = useRef(0);
  if (source !== initial) {
    setSource(initial);
    setSnapshot(initial);
  }

  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    lastStarted.current = Date.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetch("/api/gen2/home", {
        cache: "no-store",
        signal: controller.signal,
      });
      // Signed out elsewhere: stop polling; the next navigation re-authenticates.
      if (response.status === 401) {
        setSignedOut(true);
        return;
      }
      if (!response.ok) return;
      const next = (await response.json()) as Gen2HomeSnapshot;
      if (id === sequence.current) setSnapshot(next);
    } catch {
      // Offline or timed out: keep showing the last known state.
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  const update = useCallback(
    (change: (current: Gen2HomeSnapshot) => Gen2HomeSnapshot) => {
      sequence.current += 1;
      setSnapshot(change);
    },
    [],
  );

  const settling = snapshot.workspaces.some(isWorkspaceSettling);

  useEffect(() => {
    if (signedOut) return;
    let cancelled = false;
    let timer = 0;
    const visible = () => document.visibilityState === "visible";
    const tick = async () => {
      if (visible()) await refresh();
      if (!cancelled) schedule();
    };
    const schedule = () => {
      timer = window.setTimeout(
        () => void tick(),
        settling ? SETTLING_POLL_MS : IDLE_POLL_MS,
      );
    };
    const catchUp = () => {
      if (!visible()) return;
      if (Date.now() - lastStarted.current < MIN_REFRESH_GAP_MS) return;
      void refresh();
    };
    schedule();
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("focus", catchUp);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("focus", catchUp);
    };
  }, [refresh, settling, signedOut]);

  return { snapshot, refresh, update };
}

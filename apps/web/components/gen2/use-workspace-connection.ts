"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Gen2WorkspaceDetail } from "@codev/contracts";
import { ensureGen2WorkspaceReady } from "@/lib/gen2/startup-client";

import { boundedJsonRequest } from "@/lib/gen2/bounded-request";

export const CONNECTION_TIMEOUT_MS = 10_000;
export const CONNECTION_CHECK_MS = 30_000;
export const RECENT_ACTIVITY_MS = 60_000;

export function useWorkspaceConnection(
  workspaceId: string,
  enabled: boolean,
  onConnected: (workspace: Gen2WorkspaceDetail) => void,
) {
  const [state, setState] = useState<
    "checking" | "connected" | "connecting" | "disconnected"
  >("checking");
  const [error, setError] = useState("");
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);
  const connectRef = useRef<Promise<boolean> | null>(null);
  const onConnectedRef = useRef(onConnected);
  const stateRef = useRef(state);
  const mounted = useRef(true);
  const revision = useRef(0);
  const activityAt = useRef(0);
  /** The open that brought the member here starts one wake. Later checks do not. */
  const wakeOnOpen = useRef(true);
  useEffect(() => {
    onConnectedRef.current = onConnected;
    stateRef.current = state;
  }, [onConnected, state]);

  const reconnect = useCallback(() => {
    if (connectRef.current) return connectRef.current;
    const attemptRevision = ++revision.current;
    setState("connecting");
    setError("");
    setSubscriptionRequired(false);
    const promise = (async () => {
      try {
        const result = await ensureGen2WorkspaceReady(workspaceId);
        if (!mounted.current || revision.current !== attemptRevision)
          return false;
        if (result.workspace) {
          onConnectedRef.current(result.workspace);
          activityAt.current = Date.now();
          setState("connected");
          return true;
        }
        setSubscriptionRequired(result.subscriptionRequired === true);
        setError(result.error ?? "Couldn't reconnect. Please try again.");
      } catch {
        if (mounted.current)
          setError("Couldn't reconnect. Check your connection and try again.");
      }
      if (mounted.current) setState("disconnected");
      return false;
    })().finally(() => {
      connectRef.current = null;
    });
    connectRef.current = promise;
    return promise;
  }, [workspaceId]);

  useEffect(() => {
    mounted.current = true;
    activityAt.current = Date.now();
    wakeOnOpen.current = true;
    if (!enabled) return;
    const abort = new AbortController();
    let checking = false;
    async function check(initial = false) {
      if (
        checking ||
        connectRef.current ||
        (!initial && document.visibilityState === "hidden")
      )
        return;
      checking = true;
      const checkRevision = revision.current;
      try {
        const active =
          stateRef.current === "connected" &&
          Date.now() - activityAt.current < RECENT_ACTIVITY_MS;
        const { response, payload } = await boundedJsonRequest<{
          connected?: boolean;
        }>(
          `/api/gen2/workspaces/${workspaceId}/activity`,
          {
            method: active ? "POST" : "GET",
            cache: "no-store",
            signal: abort.signal,
          },
          CONNECTION_TIMEOUT_MS,
        );
        if (
          !abort.signal.aborted &&
          !connectRef.current &&
          checkRevision === revision.current
        ) {
          const connected = response.ok && payload.connected === true;
          if (connected) {
            wakeOnOpen.current = false;
            setState("connected");
            setError("");
          } else if (initial && wakeOnOpen.current) {
            wakeOnOpen.current = false;
            void reconnect();
          } else {
            setState("disconnected");
          }
        }
      } catch {
        if (
          !abort.signal.aborted &&
          !connectRef.current &&
          checkRevision === revision.current
        ) {
          if (initial && wakeOnOpen.current) {
            wakeOnOpen.current = false;
            void reconnect();
          } else {
            setState("disconnected");
          }
        }
      } finally {
        checking = false;
      }
    }
    const activity = () => {
      activityAt.current = Date.now();
    };
    const visible = () => {
      if (document.visibilityState === "visible") void check();
    };
    for (const event of ["keydown", "pointerdown", "wheel", "input"])
      window.addEventListener(event, activity, { passive: true });
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    const offline = () => setState("disconnected");
    window.addEventListener("offline", offline);
    void check(true);
    const timer = setInterval(() => void check(), CONNECTION_CHECK_MS);
    return () => {
      mounted.current = false;
      revision.current += 1;
      abort.abort();
      clearInterval(timer);
      for (const event of ["keydown", "pointerdown", "wheel", "input"])
        window.removeEventListener(event, activity);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
      window.removeEventListener("offline", offline);
    };
  }, [enabled, reconnect, workspaceId]);

  return { state, error, subscriptionRequired, reconnect };
}

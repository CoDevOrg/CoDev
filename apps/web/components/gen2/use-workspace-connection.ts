"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Gen2WorkspaceDetail } from "@codev/contracts";
import { ensureGen2WorkspaceReady } from "@/lib/gen2/startup-client";
import { switchActiveWorkspace } from "@/lib/gen2/compute-switch-client";

import { boundedJsonRequest } from "@/lib/gen2/bounded-request";

export const CONNECTION_TIMEOUT_MS = 10_000;
export const CONNECTION_CHECK_MS = 30_000;
export const CONNECTION_RETRY_MS = 2_000;
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
  const [progress, setProgress] = useState<
    Gen2WorkspaceDetail["runtimeStatus"] | null
  >(null);
  const [conflict, setConflict] = useState<{
    activeWorkspace: { id: string; name: string };
  } | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchStatus, setSwitchStatus] = useState<string | null>(null);
  const startupAbort = useRef<AbortController | null>(null);
  const connectRef = useRef<Promise<boolean> | null>(null);
  const onConnectedRef = useRef(onConnected);
  const stateRef = useRef(state);
  const mounted = useRef(true);
  const revision = useRef(0);
  const activityAt = useRef(0);
  const failedChecks = useRef(0);
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
    setProgress(null);
    setConflict(null);
    setSwitching(false);
    setSwitchStatus(null);
    startupAbort.current = new AbortController();
    const promise = (async () => {
      try {
        const result = await ensureGen2WorkspaceReady(workspaceId, {
          signal: startupAbort.current!.signal,
          isVisible: () => document.visibilityState === "visible",
          onProgress: (workspace) => {
            if (mounted.current && revision.current === attemptRevision)
              setProgress(workspace.runtimeStatus);
          },
        });
        if (!mounted.current || revision.current !== attemptRevision)
          return false;
        if (result.workspace) {
          onConnectedRef.current(result.workspace);
          failedChecks.current = 0;
          setState("connected");
          return true;
        }
        if (result.conflict) {
          setConflict(result.conflict);
        }
        setSubscriptionRequired(result.subscriptionRequired === true);
        setError(result.error ?? "Couldn't reconnect. Please try again.");
      } catch {
        if (mounted.current && revision.current === attemptRevision)
          setError("Couldn't reconnect. Check your connection and try again.");
      }
      if (mounted.current && revision.current === attemptRevision)
        setState("disconnected");
      return false;
    })().finally(() => {
      if (connectRef.current === promise) connectRef.current = null;
    });
    connectRef.current = promise;
    return promise;
  }, [workspaceId]);

  const switchWorkspace = useCallback(
    async (activeWorkspaceId: string) => {
      setSwitching(true);
      setError("");
      setSwitchStatus("Stopping active workspace...");
      try {
        const result = await switchActiveWorkspace({
          targetWorkspaceId: workspaceId,
          activeWorkspaceId,
          onProgress: (step) => {
            if (step === "stopping") {
              setSwitchStatus("Stopping active workspace...");
            } else if (step === "stopped" || step === "starting") {
              setSwitchStatus("Starting this workspace...");
            }
          },
        });
        if (!result.success) {
          setError(result.error);
          setSwitching(false);
          setSwitchStatus(null);
          return false;
        }
        setConflict(null);
        setSwitching(false);
        setSwitchStatus(null);
        return await reconnect();
      } catch {
        setError("Failed to switch workspaces. Try again.");
        setSwitching(false);
        setSwitchStatus(null);
        return false;
      }
    },
    [reconnect, workspaceId],
  );

  useEffect(() => {
    mounted.current = true;
    activityAt.current = 0;
    failedChecks.current = 0;
    wakeOnOpen.current = true;
    if (!enabled) return;
    const abort = new AbortController();
    let checking = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const failed = (initial: boolean) => {
      if (initial && wakeOnOpen.current) {
        wakeOnOpen.current = false;
        void reconnect();
      } else if (
        stateRef.current === "connected" &&
        ++failedChecks.current < 2
      ) {
        retryTimer = setTimeout(() => void check(), CONNECTION_RETRY_MS);
      } else {
        setState("disconnected");
      }
    };
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
            failedChecks.current = 0;
            clearTimeout(retryTimer);
            wakeOnOpen.current = false;
            setState("connected");
            setError("");
          } else {
            failed(initial);
          }
        }
      } catch {
        if (
          !abort.signal.aborted &&
          !connectRef.current &&
          checkRevision === revision.current
        ) {
          failed(initial);
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
      window.addEventListener(event, activity, {
        capture: true,
        passive: true,
      });
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
      startupAbort.current?.abort();
      connectRef.current = null;
      clearInterval(timer);
      clearTimeout(retryTimer);
      for (const event of ["keydown", "pointerdown", "wheel", "input"])
        window.removeEventListener(event, activity, true);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
      window.removeEventListener("offline", offline);
    };
  }, [enabled, reconnect, workspaceId]);

  return {
    state,
    error,
    subscriptionRequired,
    progress,
    conflict,
    switching,
    switchStatus,
    reconnect,
    switchWorkspace,
  };
}

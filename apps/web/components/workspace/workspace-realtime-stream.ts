"use client";

import { useEffect, useRef } from "react";

import {
  workspaceRealtimeEventSchema,
  type WorkspaceRealtimeEvent,
} from "@codev/contracts";
import type { CodevWorkspaceStreamStatus } from "./codev-parent-bridge";

const MAX_RETRY_DELAY_MS = 15_000;

/**
 * Own the workspace's one browser-side EventSource. Consumers receive
 * invalidations and continue to hydrate their own projections through the
 * workspace bridge, so this hook never carries application data in React
 * state and never opens one connection per panel.
 */
export function useWorkspaceRealtimeStream({
  workspaceId,
  onEvent,
  onStatus,
}: {
  workspaceId: string;
  onEvent: (event: WorkspaceRealtimeEvent, cursor: string) => void;
  onStatus: (status: CodevWorkspaceStreamStatus) => void;
}): void {
  const onEventRef = useRef(onEvent);
  const onStatusRef = useRef(onStatus);

  useEffect(() => {
    onEventRef.current = onEvent;
    onStatusRef.current = onStatus;
  }, [onEvent, onStatus]);

  useEffect(() => {
    let closed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let cursor: string | null = null;

    const report = (status: CodevWorkspaceStreamStatus) => {
      onStatusRef.current(status);
    };

    const schedule = () => {
      if (closed) return;
      const delay = Math.min(
        MAX_RETRY_DELAY_MS,
        1_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 4),
      );
      retryTimer = setTimeout(connect, delay);
    };

    const connect = () => {
      if (closed) return;
      const query = cursor ? `?after=${encodeURIComponent(cursor)}` : "";
      const next = new EventSource(
        `/api/workspaces/${workspaceId}/events/stream${query}`,
      );
      source = next;
      next.onopen = () => {
        attempts = 0;
        report("connected");
      };
      next.onmessage = (message) => {
        let data: unknown;
        try {
          data = JSON.parse(message.data) as unknown;
        } catch {
          return;
        }
        const parsed = workspaceRealtimeEventSchema.safeParse(data);
        if (!parsed.success) return;
        if (message.lastEventId) cursor = message.lastEventId;
        if (cursor) onEventRef.current(parsed.data, cursor);
      };
      next.onerror = () => {
        next.close();
        if (source === next) source = null;
        attempts += 1;
        report(attempts >= 3 ? "unavailable" : "reconnecting");
        schedule();
      };
    };

    report("reconnecting");
    connect();

    return () => {
      closed = true;
      source?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [workspaceId]);
}

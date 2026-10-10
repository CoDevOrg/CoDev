"use client";

import { useMemo, useRef, useState } from "react";
import type { Gen2AgentProviderName, Gen2TurnItem } from "@codev/contracts";

import { useRealtimeEvent, useRealtimeResync } from "./use-workspace-realtime";

/** A turn another tab drives, as its pushed progress shows it. */
export interface ObservedTurn {
  chatId: string;
  sessionId: string;
  userId: string;
  provider: Gen2AgentProviderName;
  items: Gen2TurnItem[];
  reply: string;
  /** When this tab last heard from the turn, for the drive election. */
  lastProgressAt: number;
}

/**
 * Running turns other tabs started, keyed by chat. This tab's own turn is
 * left out (`ownSessionId`): it already shows that one live. A settled turn
 * never comes back from a late progress message.
 */
export function useObservedTurns(ownSessionId: string | null) {
  const [turns, setTurns] = useState<Map<string, ObservedTurn>>(new Map());
  const settled = useRef(new Set<string>());

  const upsert = (turn: Omit<ObservedTurn, "lastProgressAt">) => {
    if (settled.current.has(turn.sessionId)) return;
    setTurns((current) =>
      new Map(current).set(turn.chatId, {
        ...turn,
        lastProgressAt: Date.now(),
      }),
    );
  };
  useRealtimeEvent("turn.started", (event) =>
    upsert({ ...event, items: [], reply: "" }),
  );
  useRealtimeEvent("turn.progress", (event) => upsert(event));
  useRealtimeEvent("turn.settled", (event) => {
    settled.current.add(event.sessionId);
    setTurns((current) => {
      if (current.get(event.chatId)?.sessionId !== event.sessionId)
        return current;
      const next = new Map(current);
      next.delete(event.chatId);
      return next;
    });
  });
  // Missed messages may include a settle; progress repopulates what still runs.
  useRealtimeResync(() => setTurns(new Map()));
  // The start is announced before this tab learns its own session id.
  return useMemo(
    () =>
      new Map([...turns].filter(([, turn]) => turn.sessionId !== ownSessionId)),
    [turns, ownSessionId],
  );
}

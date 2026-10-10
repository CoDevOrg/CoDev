"use client";

import { useEffect, useRef } from "react";

import type { ObservedTurn } from "./use-observed-turns";
import { useWorkspaceRealtime } from "./use-workspace-realtime";

/** Silence after which another tab assumes the turn's own tab has gone. */
const QUIET_MS = 15_000;
const IDLE_RETRY_MS = 5_000;

/** The one tab that drives quiet turns: the lowest visible editor connection. */
export function electedConnection(
  presence: ReturnType<typeof useWorkspaceRealtime>["presence"],
  members: ReturnType<typeof useWorkspaceRealtime>["members"],
) {
  const editors = new Set(
    members
      .filter((member) => member.role !== "viewer")
      .map((member) => member.userId),
  );
  return (
    presence
      .filter(
        (entry) => !entry.agent && !entry.away && editors.has(entry.user.id),
      )
      .map((entry) => entry.connectionId)
      .sort()[0] ?? null
  );
}

async function drive(workspaceId: string, sessionId: string) {
  const response = await fetch(
    `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/agent/drive`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    },
  ).catch(() => null);
  if (!response?.ok) return false;
  const payload = (await response.json().catch(() => null)) as {
    polled?: boolean;
  } | null;
  return payload?.polled === true;
}

/**
 * Keeps other members' turns moving after their tab closes: one elected tab
 * polls any turn that has gone quiet, so its output, reply and file edits
 * still reach everyone. The server polls as the turn's owner.
 */
export function useTurnDriveElection(input: {
  workspaceId: string;
  canEdit: boolean;
  turns: Map<string, ObservedTurn>;
}) {
  const { presence, members, connectionId } = useWorkspaceRealtime();
  const elected =
    input.canEdit &&
    connectionId !== null &&
    electedConnection(presence, members) === connectionId;
  const turnsRef = useRef(input.turns);
  useEffect(() => {
    turnsRef.current = input.turns;
  }, [input.turns]);

  useEffect(() => {
    if (!elected) return;
    let stopped = false;
    let timer: number | null = null;
    const tick = async () => {
      const quiet = [...turnsRef.current.values()].filter(
        (turn) => Date.now() - turn.lastProgressAt > QUIET_MS,
      );
      for (const turn of quiet) {
        if (stopped) return;
        await drive(input.workspaceId, turn.sessionId);
      }
      if (!stopped) timer = window.setTimeout(tick, IDLE_RETRY_MS);
    };
    timer = window.setTimeout(tick, IDLE_RETRY_MS);
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [elected, input.workspaceId]);
}

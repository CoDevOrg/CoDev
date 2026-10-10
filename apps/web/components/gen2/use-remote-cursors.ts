"use client";

import { useEffect, useMemo, useState } from "react";
import { presenceCursorSchema } from "@codev/contracts";
import type { Awareness } from "y-protocols/awareness";

import { agentLabel } from "./agent-label";
import type { RemoteCursor } from "./codemirror-remote-cursors";
import { memberColor } from "./member-color";
import { useWorkspaceRealtime } from "./use-workspace-realtime";

type AwarenessUser = { id?: string; name?: string | null; login?: string };

/** People's cursors from this file's awareness, minus this member's tabs. */
function awarenessCursors(awareness: Awareness, meId: string | null) {
  const cursors: RemoteCursor[] = [];
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return;
    const user = state.user as AwarenessUser | undefined;
    const cursor = presenceCursorSchema.safeParse(state.cursor);
    if (!user?.id || user.id === meId || !cursor.success) return;
    cursors.push({
      id: `${user.id}:${clientId}`,
      label: user.name || user.login || "Member",
      color: memberColor(user.id).color,
      kind: "person",
      ...cursor.data,
    });
  });
  return cursors;
}

/**
 * Everyone else's cursor in the open file: members from the document's
 * awareness, agents from presence (placed at their latest edit).
 */
export function useRemoteCursors(input: {
  awareness: Awareness | null;
  worktreeId: string;
  path: string | null;
}) {
  const { presence, me } = useWorkspaceRealtime();
  const meId = me?.id ?? null;
  const [people, setPeople] = useState<RemoteCursor[]>([]);
  const { awareness, worktreeId, path } = input;

  useEffect(() => {
    if (!awareness) return;
    const refresh = () => setPeople(awarenessCursors(awareness, meId));
    refresh();
    awareness.on("change", refresh);
    return () => awareness.off("change", refresh);
  }, [awareness, meId]);

  return useMemo(() => {
    const agents = presence.flatMap((entry): RemoteCursor[] =>
      entry.agent &&
      entry.cursor &&
      entry.path === path &&
      entry.worktreeId === worktreeId
        ? [
            {
              id: entry.agent.sessionId,
              label: agentLabel(
                entry.agent.provider,
                entry.user.name || entry.user.login,
              ),
              color: memberColor(entry.agent.sessionId).color,
              kind: "agent",
              ...entry.cursor,
            },
          ]
        : [],
    );
    return awareness ? [...people, ...agents] : agents;
  }, [awareness, people, presence, path, worktreeId]);
}

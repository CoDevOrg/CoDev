"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { providerName } from "./agent-label";
import type { PresencePerson } from "./use-workspace-presence";
import {
  useRealtimeEvent,
  useWorkspaceRealtime,
} from "./use-workspace-realtime";

/** Announces new arrivals once; the first snapshot is who was already here. */
function useJoinToasts(people: PresencePerson[]) {
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(people.map((person) => person.userId));
    if (known.current === null) {
      if (ids.size) known.current = ids;
      return;
    }
    for (const person of people) {
      if (person.isSelf || known.current.has(person.userId)) continue;
      toast(`${person.user.name || person.user.login} joined`);
    }
    known.current = ids;
  }, [people]);
}

/**
 * Short notices for what happens elsewhere in the workspace: someone joins,
 * someone else starts an agent, an agent finishes a chat you are not
 * looking at (with a shortcut to its changes).
 */
export function useWorkspaceActivityToasts(input: {
  people: PresencePerson[];
  currentChatId: string | null;
  branchFor: (worktreeId: string) => string;
  onViewChanges: () => void;
}) {
  const { me, members } = useWorkspaceRealtime();
  const nameOf = (userId: string) => {
    const member = members.find((entry) => entry.userId === userId);
    return member ? member.name || member.login : "Someone";
  };
  useJoinToasts(input.people);
  useRealtimeEvent("turn.started", (event) => {
    if (event.userId === me?.id) return;
    const where = event.worktreeId
      ? ` in ${input.branchFor(event.worktreeId)}`
      : "";
    toast(
      `${nameOf(event.userId)} started ${providerName(event.provider)}${where}`,
    );
  });
  useRealtimeEvent("turn.settled", (event) => {
    if (event.chatId === input.currentChatId) return;
    const files = event.changedPaths.length;
    const result =
      event.status === "failed"
        ? "stopped with an error"
        : files
          ? `finished · ${files} file${files === 1 ? "" : "s"} changed`
          : "finished";
    toast(`${providerName(event.provider)} ${result}`, {
      description: `${nameOf(event.userId)}’s turn`,
      ...(files
        ? { action: { label: "View changes", onClick: input.onViewChanges } }
        : {}),
    });
  });
}

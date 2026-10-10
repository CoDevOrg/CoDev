"use client";

import { useMemo } from "react";
import type {
  CollaborationPresenceEntry,
  CollaborationUser,
  Gen2AgentProviderName,
  Gen2WorkspaceMember,
  Gen2WorkspaceView,
} from "@codev/contracts";

import { useWorkspaceRealtime } from "./use-workspace-realtime";

export interface PresencePerson {
  userId: string;
  user: CollaborationUser;
  role: Gen2WorkspaceMember["role"] | null;
  isSelf: boolean;
  away: boolean;
  worktreeId: string | null;
  path: string | null;
  view: Gen2WorkspaceView | null;
  chatId: string | null;
}

export interface PresenceAgent {
  sessionId: string;
  provider: Gen2AgentProviderName;
  chatId: string;
  owner: CollaborationUser;
  worktreeId: string | null;
  path: string | null;
  cursor: CollaborationPresenceEntry["cursor"];
}

/** Who is in a file: people other than this tab, and agents. */
export type FilePresence = Array<
  | { kind: "person"; id: string; person: PresencePerson }
  | { kind: "agent"; id: string; agent: PresenceAgent }
>;

function toAgent(
  entry: CollaborationPresenceEntry,
  agent: NonNullable<CollaborationPresenceEntry["agent"]>,
): PresenceAgent {
  return {
    ...agent,
    owner: entry.user,
    worktreeId: entry.worktreeId,
    path: entry.path,
    cursor: entry.cursor,
  };
}

const byRecency = (
  left: CollaborationPresenceEntry,
  right: CollaborationPresenceEntry,
) =>
  Number(left.away) - Number(right.away) ||
  right.lastSeenAt.localeCompare(left.lastSeenAt);

/**
 * One avatar per member however many tabs they have open: their most recent
 * visible tab says where they are. Agents are listed separately.
 */
export function summarizePresence(input: {
  presence: CollaborationPresenceEntry[];
  members: Gen2WorkspaceMember[];
  meId: string | null;
}) {
  const people = new Map<string, PresencePerson>();
  const agents: PresenceAgent[] = [];
  for (const entry of [...input.presence].sort(byRecency)) {
    if (entry.agent) {
      agents.push(toAgent(entry, entry.agent));
      continue;
    }
    if (people.has(entry.user.id)) continue;
    const member = input.members.find((m) => m.userId === entry.user.id);
    people.set(entry.user.id, {
      userId: entry.user.id,
      user: entry.user,
      role: member?.role ?? null,
      isSelf: entry.user.id === input.meId,
      away: entry.away,
      worktreeId: entry.worktreeId,
      path: entry.path,
      view: entry.view,
      chatId: entry.chatId,
    });
  }
  return { people: [...people.values()], agents };
}

/** Everyone else in each file of `worktreeId`, keyed by path. */
export function presenceByPath(
  presence: CollaborationPresenceEntry[],
  worktreeId: string,
  connectionId: string | null,
  people: PresencePerson[],
) {
  const files = new Map<string, FilePresence>();
  const seen = new Set<string>();
  for (const entry of presence) {
    if (entry.connectionId === connectionId || !entry.path) continue;
    if (entry.worktreeId !== worktreeId) continue;
    const id = entry.agent ? entry.agent.sessionId : entry.user.id;
    if (seen.has(`${entry.path}\0${id}`)) continue;
    seen.add(`${entry.path}\0${id}`);
    const list = files.get(entry.path) ?? [];
    const person = people.find((p) => p.userId === entry.user.id);
    if (entry.agent)
      list.push({ kind: "agent", id, agent: toAgent(entry, entry.agent) });
    else if (person) list.push({ kind: "person", id, person });
    files.set(entry.path, list);
  }
  return files;
}

export function useWorkspacePresence(worktreeId: string) {
  const { presence, members, me, connectionId } = useWorkspaceRealtime();
  return useMemo(() => {
    const summary = summarizePresence({
      presence,
      members,
      meId: me?.id ?? null,
    });
    return {
      ...summary,
      byPath: presenceByPath(
        presence,
        worktreeId,
        connectionId,
        summary.people,
      ),
    };
  }, [presence, members, me, connectionId, worktreeId]);
}

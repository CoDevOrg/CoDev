"use client";

import {
  type CSSProperties,
  type ReactNode,
  useSyncExternalStore,
} from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MemberAvatar } from "./member-avatar";
import { memberColor } from "./member-color";
import { ProviderLogo } from "./provider-logos";
import { agentLabel } from "./agent-label";
import type { PresenceAgent, PresencePerson } from "./use-workspace-presence";

export type FollowTarget =
  | { kind: "person"; userId: string }
  | { kind: "agent"; sessionId: string };

type Entry = {
  key: string;
  target: FollowTarget;
  label: string;
  detail: string;
  avatar: ReactNode;
};

const VIEW_LABELS: Record<string, string> = {
  chat: "in chat",
  files: "browsing files",
  changes: "reviewing changes",
  review: "reviewing changes",
  browser: "in the browser preview",
  board: "on the board",
};

const personName = (user: { name: string | null; login: string }) =>
  user.name || user.login;
const fileName = (path: string) => path.split("/").at(-1) ?? path;
const roleName = (role: string | null) =>
  role ? `${role[0]!.toUpperCase()}${role.slice(1)} · ` : "";

function personEntry(
  person: PresencePerson,
  branchFor: (id: string) => string,
): Entry {
  const place = person.path
    ? `editing ${fileName(person.path)}`
    : (VIEW_LABELS[person.view ?? ""] ?? "here");
  const branch = person.worktreeId ? `${branchFor(person.worktreeId)} · ` : "";
  return {
    key: `person:${person.userId}`,
    target: { kind: "person", userId: person.userId },
    label: personName(person.user),
    detail: person.away
      ? `${roleName(person.role)}Away`
      : `${roleName(person.role)}${branch}${place}`,
    avatar: (
      <MemberAvatar
        id={person.userId}
        name={personName(person.user)}
        avatarUrl={person.user.avatarUrl}
        away={person.away}
      />
    ),
  };
}

function agentEntry(
  agent: PresenceAgent,
  branchFor: (id: string) => string,
): Entry {
  const color = memberColor(agent.sessionId);
  const branch = agent.worktreeId ? `${branchFor(agent.worktreeId)} · ` : "";
  return {
    key: `agent:${agent.sessionId}`,
    target: { kind: "agent", sessionId: agent.sessionId },
    label: agentLabel(agent.provider, personName(agent.owner)),
    detail: `${branch}${agent.path ? `editing ${fileName(agent.path)}` : "working"}`,
    avatar: (
      <span
        className="gen2-presence-agent"
        style={{ "--member-color": color.color } as CSSProperties}
      >
        <ProviderLogo provider={agent.provider} size={14} aria-hidden="true" />
      </span>
    ),
  };
}

function StackItem({
  entry,
  onFollow,
}: {
  entry: Entry;
  onFollow?: ((target: FollowTarget) => void) | undefined;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="gen2-presence-item"
          aria-label={`${entry.label}, ${entry.detail}${onFollow ? ". Follow" : ""}`}
          onClick={() => onFollow?.(entry.target)}
        >
          {entry.avatar}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="gen2-workspace-surface gen2-presence-tooltip"
      >
        <strong>{entry.label}</strong>
        <span>{entry.detail}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function useMatches(query: string) {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Fewer avatars as the bar narrows; a phone shows only the count. */
function useVisibleCount(max: number) {
  const tablet = useMatches("(max-width: 1023px)");
  const phone = useMatches("(max-width: 767px)");
  return phone ? 0 : tablet ? Math.min(max, 2) : max;
}

/**
 * Everyone else in the workspace right now, people first, then running
 * agents. Hover names them and says where they are; a click follows them.
 */
export function WorkspacePresenceStack({
  people,
  agents,
  branchFor,
  onFollow,
  max = 4,
}: {
  people: PresencePerson[];
  agents: PresenceAgent[];
  branchFor: (worktreeId: string) => string;
  onFollow?: ((target: FollowTarget) => void) | undefined;
  max?: number;
}) {
  const entries = [
    ...people
      .filter((person) => !person.isSelf)
      .map((person) => personEntry(person, branchFor)),
    ...agents.map((agent) => agentEntry(agent, branchFor)),
  ];
  const visibleCount = useVisibleCount(max);
  if (!entries.length) return null;
  const visible = entries.slice(0, visibleCount);
  const hidden = entries.length - visible.length;
  return (
    <div
      className="gen2-presence-stack"
      role="group"
      aria-label={`${entries.length} other${entries.length === 1 ? "" : "s"} in this workspace`}
    >
      {visible.map((entry) => (
        <StackItem key={entry.key} entry={entry} onFollow={onFollow} />
      ))}
      {hidden > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="gen2-presence-item gen2-presence-more"
              aria-label={`Show all ${entries.length} people and agents`}
            >
              {visible.length ? `+${hidden}` : hidden}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="gen2-workspace-surface gen2-presence-menu"
          >
            <DropdownMenuLabel>In this workspace</DropdownMenuLabel>
            {entries.map((entry) => (
              <DropdownMenuItem
                key={entry.key}
                onSelect={() => onFollow?.(entry.target)}
              >
                {entry.avatar}
                <span className="gen2-presence-menu-text">
                  <span>{entry.label}</span>
                  <span>{entry.detail}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

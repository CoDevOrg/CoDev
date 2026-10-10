"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Gen2WorkspaceView } from "@codev/contracts";

import { agentLabel } from "./agent-label";
import { memberColor } from "./member-color";
import type { FollowTarget } from "./workspace-presence-stack";
import type { PresenceAgent, PresencePerson } from "./use-workspace-presence";
import type { WorkspaceInspectorTab } from "./workspace-action-run";

/** Where the followed person or agent is, and how to show them. */
export interface FollowPosition {
  /** Matches their cursor in the open file. */
  cursorId: string;
  label: string;
  color: string;
  worktreeId: string | null;
  path: string | null;
  view: Gen2WorkspaceView | null;
  chatId: string | null;
}

const INSPECTOR_VIEWS = new Set<string>([
  "files",
  "changes",
  "review",
  "browser",
]);

export function followPosition(
  target: FollowTarget | null,
  people: PresencePerson[],
  agents: PresenceAgent[],
): FollowPosition | null {
  if (target?.kind === "person") {
    const person = people.find((entry) => entry.userId === target.userId);
    if (!person || person.isSelf) return null;
    return {
      ...person,
      cursorId: person.userId,
      label: person.user.name || person.user.login,
      color: memberColor(person.userId).color,
    };
  }
  if (target?.kind === "agent") {
    const agent = agents.find((entry) => entry.sessionId === target.sessionId);
    if (!agent) return null;
    return {
      ...agent,
      cursorId: agent.sessionId,
      label: agentLabel(agent.provider, agent.owner.name || agent.owner.login),
      color: memberColor(agent.sessionId).color,
      view: agent.path ? "files" : "chat",
    };
  }
  return null;
}

/** Any input of the member's own in the workspace ends following. */
function useStopOnInput(active: boolean, stop: () => void) {
  useEffect(() => {
    if (!active) return;
    const onInput = (event: Event) => {
      if (!event.isTrusted) return;
      if (event instanceof KeyboardEvent && event.key === "Escape")
        return stop();
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".gen2-presence-stack, .gen2-follow-chip")) return;
      if (!target?.closest(".gen2-ide-container")) return;
      stop();
    };
    const events = ["wheel", "pointerdown", "keydown"] as const;
    events.forEach((name) => window.addEventListener(name, onInput, true));
    return () =>
      events.forEach((name) => window.removeEventListener(name, onInput, true));
  }, [active, stop]);
}

/**
 * Follow mode: mirrors another member's or an agent's worktree, file, view
 * and chat until the member does anything themselves. It never discards
 * unsaved work; it stops and says why instead.
 */
export function useWorkspaceFollow(input: {
  people: PresencePerson[];
  agents: PresenceAgent[];
  worktreeId: string;
  dirty: boolean;
  selectWorktree: (worktreeId: string) => void;
  openFile: (path: string) => void;
  showTab: (tab: WorkspaceInspectorTab) => void;
  selectChat: (chatId: string) => void;
  onStopped: (reason: string) => void;
}) {
  const [target, setTarget] = useState<FollowTarget | null>(null);
  const position = followPosition(target, input.people, input.agents);
  const stop = useCallback(() => setTarget(null), []);
  useStopOnInput(position !== null, stop);
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });

  const { worktreeId: at, path, view, chatId } = position ?? {};
  const following = position !== null;
  useEffect(() => {
    if (!following) return;
    const current = latest.current;
    if (at && at !== current.worktreeId) {
      if (current.dirty) {
        queueMicrotask(stop);
        current.onStopped("Stopped following: you have unsaved changes here.");
      } else current.selectWorktree(at);
      return;
    }
    if (path) current.openFile(path);
    else if (view && INSPECTOR_VIEWS.has(view))
      current.showTab(view as WorkspaceInspectorTab);
    if (chatId) current.selectChat(chatId);
  }, [following, at, path, view, chatId, input.worktreeId, stop]);

  return { target, position, follow: setTarget, stop };
}

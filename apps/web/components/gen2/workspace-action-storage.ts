"use client";

import {
  gen2WorkspaceActionSchema,
  type Gen2WorkspaceAction,
} from "@codev/contracts";

import type {
  PendingWorkspaceAction,
  WorkspaceActionOutcome,
} from "./use-workspace-action-dispatch";

/**
 * Per-tab memory for agent workspace actions, in sessionStorage: which live
 * items this tab already handled, the proposals still waiting for the
 * member, and what happened to each action. Nothing here is shared with
 * other tabs or members, by design: an action is only ever offered in the
 * tab that drove its turn. Storage may be unavailable; every read falls back
 * to empty and every write is best effort.
 */

const LIMIT = 200;
const OUTCOMES = "codev-gen2-action-outcomes";
export const WORKSPACE_ACTION_OUTCOME_EVENT = "codev:workspace-action-outcome";

/** A proposal plus what this tab needs to settle it later. */
export type StoredPendingAction = PendingWorkspaceAction & {
  itemId: string;
  /** The turn's session id; links an open_preview to its run_in_terminal. */
  turn: string;
};

function read(key: string): unknown {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private mode or a full quota: this tab simply forgets. */
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A short hash of the action, so a reused item id never inherits an outcome. */
export function fingerprintWorkspaceAction(action: Gen2WorkspaceAction) {
  let hash = 0x811c9dc5;
  for (const char of canonical(action)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

const seenKey = (workspaceId: string) => `codev-gen2-actions:${workspaceId}`;
const pendingKey = (workspaceId: string, chatId: string) =>
  `codev-gen2-pending:${workspaceId}:${chatId}`;

export function readSeenActionKeys(workspaceId: string): string[] {
  const value = read(seenKey(workspaceId));
  return Array.isArray(value)
    ? value.filter((key): key is string => typeof key === "string")
    : [];
}

export function rememberSeenActionKeys(workspaceId: string, keys: string[]) {
  if (!keys.length) return;
  const merged = [...readSeenActionKeys(workspaceId), ...keys];
  write(seenKey(workspaceId), [...new Set(merged)].slice(-LIMIT));
}

function isStoredPending(value: unknown): value is StoredPendingAction {
  const entry = value as Partial<StoredPendingAction> | null;
  return (
    !!entry &&
    typeof entry.key === "string" &&
    typeof entry.chatId === "string" &&
    typeof entry.itemId === "string" &&
    typeof entry.turn === "string" &&
    (entry.blocker === null || typeof entry.blocker === "string") &&
    gen2WorkspaceActionSchema.safeParse(entry.action).success
  );
}

export function readPendingActions(workspaceId: string, chatId: string) {
  const value = read(pendingKey(workspaceId, chatId));
  return Array.isArray(value) ? value.filter(isStoredPending) : [];
}

export function writePendingActions(
  workspaceId: string,
  chatId: string,
  pending: StoredPendingAction[],
) {
  write(pendingKey(workspaceId, chatId), pending.slice(-LIMIT));
}

const outcomeKey = (
  chatId: string,
  itemId: string,
  action: Gen2WorkspaceAction,
) => `${chatId}:${itemId}:${fingerprintWorkspaceAction(action)}`;

function readOutcomes(): Array<[string, WorkspaceActionOutcome]> {
  const value = read(OUTCOMES);
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is [string, WorkspaceActionOutcome] =>
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          typeof entry[1]?.message === "string" &&
          ["done", "dismissed", "auto"].includes(entry[1]?.state),
      )
    : [];
}

export function readStoredActionOutcome(
  chatId: string,
  itemId: string,
  action: Gen2WorkspaceAction,
): WorkspaceActionOutcome | null {
  const key = outcomeKey(chatId, itemId, action);
  return readOutcomes().find(([entry]) => entry === key)?.[1] ?? null;
}

export function writeStoredActionOutcome(
  chatId: string,
  itemId: string,
  action: Gen2WorkspaceAction,
  outcome: WorkspaceActionOutcome,
) {
  const key = outcomeKey(chatId, itemId, action);
  const rest = readOutcomes().filter(([entry]) => entry !== key);
  write(OUTCOMES, [...rest, [key, outcome]].slice(-LIMIT));
  window.dispatchEvent(new Event(WORKSPACE_ACTION_OUTCOME_EVENT));
}

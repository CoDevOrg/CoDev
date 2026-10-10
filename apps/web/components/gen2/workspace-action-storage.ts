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

/** An action item as this tab records what happened to it. */
export type WorkspaceActionRef = {
  chatId: string;
  itemId: string;
  /** The turn's nonce; item ids repeat across turns, nonces do not. */
  token: string | null;
  action: Gen2WorkspaceAction;
};

/** A proposal plus what this tab needs to settle it later. */
export type StoredPendingAction = PendingWorkspaceAction & {
  itemId: string;
  token: string;
  /** The turn's session id; links an open_preview to its run_in_terminal. */
  turn: string;
};

function rawItem(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function parse(raw: string | null): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const read = (key: string) => parse(rawItem(key));

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

/**
 * A short hash of the action and its turn's nonce. Codex and Cursor number
 * their messages from zero every turn, so the same item id and action recur
 * in one chat; only the nonce tells those turns apart.
 */
function fingerprint(token: string | null, action: Gen2WorkspaceAction) {
  let hash = 0x811c9dc5;
  for (const char of canonical({ token, action })) {
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
    typeof entry.token === "string" &&
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

const outcomeKey = ({ chatId, itemId, token, action }: WorkspaceActionRef) =>
  `${chatId}:${itemId}:${fingerprint(token, action)}`;

function isOutcome(entry: unknown): entry is [string, WorkspaceActionOutcome] {
  const [key, outcome] = Array.isArray(entry) ? entry : [];
  return (
    typeof key === "string" &&
    typeof outcome?.message === "string" &&
    ["done", "dismissed", "auto"].includes(outcome?.state)
  );
}

// Every action row reads its outcome on each render; parse the stored list
// only when it changed, and hand out the same objects until then.
let cache: {
  raw: string | null;
  outcomes: Map<string, WorkspaceActionOutcome>;
} | null = null;

function readOutcomes() {
  const raw = rawItem(OUTCOMES);
  if (cache?.raw === raw) return cache.outcomes;
  const value = parse(raw);
  const entries = Array.isArray(value) ? value.filter(isOutcome) : [];
  cache = { raw, outcomes: new Map(entries) };
  return cache.outcomes;
}

/** The same object for as long as the outcome is unchanged. */
export function readStoredActionOutcome(
  ref: WorkspaceActionRef,
): WorkspaceActionOutcome | null {
  return readOutcomes().get(outcomeKey(ref)) ?? null;
}

export function writeStoredActionOutcome(
  ref: WorkspaceActionRef,
  outcome: WorkspaceActionOutcome,
) {
  const key = outcomeKey(ref);
  const outcomes = new Map(readOutcomes());
  outcomes.delete(key);
  outcomes.set(key, outcome);
  write(OUTCOMES, [...outcomes].slice(-LIMIT));
  window.dispatchEvent(new Event(WORKSPACE_ACTION_OUTCOME_EVENT));
}

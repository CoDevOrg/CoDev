"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Gen2TurnItem, Gen2WorkspaceAction } from "@codev/contracts";

import { isWorkspaceNavigation } from "./workspace-action-blocker";
import { workspaceActionCopy } from "./workspace-action-copy";
import {
  readPendingActions,
  readSeenActionKeys,
  readStoredActionOutcome,
  rememberSeenActionKeys,
  writePendingActions,
  writeStoredActionOutcome,
  type StoredPendingAction,
} from "./workspace-action-storage";
import {
  useWorkspaceAgent,
  type WorkspaceAgentContextValue,
  type WorkspaceController,
} from "./workspace-controller";

export type PendingWorkspaceAction = {
  key: string;
  chatId: string;
  action: Gen2WorkspaceAction;
  blocker: string | null;
};

export type WorkspaceActionOutcome = {
  state: "done" | "dismissed" | "auto";
  message: string;
};

type Live = {
  sessionId: string;
  actionNonce: string | null;
  items: Gen2TurnItem[];
};

const WAITS_FOR_COMMAND = "Opens after you run the command";

/** What this tab did with an action item, if anything; null when unknown. */
export function readWorkspaceActionOutcome(
  chatId: string,
  item: Gen2TurnItem,
): WorkspaceActionOutcome | null {
  if (item.kind !== "workspaceAction" || !item.action) return null;
  return readStoredActionOutcome(chatId, item.id, item.action);
}

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * What to do with the workspace actions this tab has not seen yet. Only
 * valid items carrying the turn's nonce count; the rest are remembered as
 * seen and never acted on.
 */
function planLiveActions(
  live: Live,
  chatId: string,
  known: Set<string>,
  controller: WorkspaceController,
) {
  const fresh = live.items.filter(
    (item) =>
      item.kind === "workspaceAction" &&
      !known.has(`${live.sessionId}:${item.id}`),
  );
  const trusted = live.items.flatMap((item) =>
    item.kind === "workspaceAction" &&
    item.action &&
    live.actionNonce &&
    item.token === live.actionNonce
      ? [{ itemId: item.id, action: item.action }]
      : [],
  );
  const runsCommand = trusted.some(
    (entry) => entry.action.type === "run_in_terminal",
  );
  const plan = trusted
    .filter(
      ({ itemId, action }) =>
        fresh.some((item) => item.id === itemId) &&
        action.type !== "update_goal",
    )
    .map(({ itemId, action }) => {
      let blocker = controller.autoRunBlocker(action);
      if (action.type === "open_preview" && blocker && runsCommand)
        blocker = WAITS_FOR_COMMAND;
      const key = `${live.sessionId}:${itemId}`;
      return { key, chatId, action, blocker, itemId, turn: live.sessionId };
    });
  const runs = (entry: StoredPendingAction) =>
    isWorkspaceNavigation(entry.action) && entry.blocker === null;
  return {
    seen: fresh.map((item) => `${live.sessionId}:${item.id}`),
    auto: plan.filter(runs),
    queued: plan.filter((entry) => !runs(entry)),
  };
}

/** Holds a chat's proposals, mirrored to this tab's sessionStorage. */
function usePendingActions(workspaceId: string, chatId: string | null) {
  const [state, setState] = useState(() => ({
    chatId,
    list: chatId ? readPendingActions(workspaceId, chatId) : [],
  }));
  let list = state.list;
  if (state.chatId !== chatId) {
    list = chatId ? readPendingActions(workspaceId, chatId) : [];
    setState({ chatId, list });
  }
  useEffect(() => {
    if (state.chatId)
      writePendingActions(workspaceId, state.chatId, state.list);
  }, [state, workspaceId]);
  const update = useCallback(
    (change: (current: StoredPendingAction[]) => StoredPendingAction[]) =>
      setState((current) => ({ ...current, list: change(current.list) })),
    [],
  );
  return [list, update] as const;
}

/** Records an outcome for a settled proposal (or its linked preview). */
function settle(
  entry: StoredPendingAction,
  state: WorkspaceActionOutcome["state"],
  message?: string,
) {
  const fallback =
    state === "dismissed"
      ? "Dismissed"
      : workspaceActionCopy(entry.action).done;
  writeStoredActionOutcome(entry.chatId, entry.itemId, entry.action, {
    state,
    message: message ?? fallback,
  });
}

type UpdatePending = ReturnType<typeof usePendingActions>[1];
type AgentRef = RefObject<WorkspaceAgentContextValue | null>;

/** Handles each new item of the live turn once: run it, queue it, or ignore it. */
function useLiveActions(
  workspaceId: string,
  chatId: string | null,
  live: Live | null,
  agentRef: AgentRef,
  updatePending: UpdatePending,
) {
  const [announcement, setAnnouncement] = useState("");
  const seen = useRef<Set<string> | null>(null);
  const items = live?.items;
  const sessionId = live?.sessionId;
  const actionNonce = live?.actionNonce ?? null;
  useEffect(() => {
    const controller = agentRef.current?.controller;
    if (!items || !sessionId || !chatId || !controller) return;
    seen.current ??= new Set(readSeenActionKeys(workspaceId));
    const turn = { sessionId, actionNonce, items };
    const next = planLiveActions(turn, chatId, seen.current, controller);
    next.seen.forEach((key) => seen.current?.add(key));
    rememberSeenActionKeys(workspaceId, next.seen);
    const { queued } = next;
    if (queued.length) updatePending((list) => [...list, ...queued]);
    for (const entry of next.auto) {
      void controller.run(entry.action).then((result) => {
        if (!result.ok) {
          const blocked = { ...entry, blocker: result.message };
          updatePending((list) => [...list, blocked]);
          return;
        }
        settle(entry, "auto", result.message);
        const done = workspaceActionCopy(entry.action).done;
        setAnnouncement(`Agent ${lowerFirst(done)}`);
      });
    }
  }, [
    items,
    sessionId,
    actionNonce,
    chatId,
    workspaceId,
    agentRef,
    updatePending,
  ]);
  return announcement;
}

/** Settles a proposal; accepting a command also opens the preview it waited for. */
function useResolve(
  pending: StoredPendingAction[],
  updatePending: UpdatePending,
  agentRef: AgentRef,
) {
  return useCallback(
    (key: string, outcome: "done" | "dismissed", message?: string) => {
      const entry = pending.find((candidate) => candidate.key === key);
      if (!entry) return;
      const linked =
        outcome === "done" && entry.action.type === "run_in_terminal"
          ? pending.filter(
              (other) =>
                other.turn === entry.turn &&
                other.action.type === "open_preview",
            )
          : [];
      const settledKeys = new Set([key, ...linked.map((other) => other.key)]);
      updatePending((list) =>
        list.filter((other) => !settledKeys.has(other.key)),
      );
      settle(entry, outcome, message);
      const controller = agentRef.current?.controller;
      for (const other of linked) {
        void controller
          ?.run(other.action)
          .then((result) =>
            settle(other, result.ok ? "done" : "dismissed", result.message),
          );
      }
    },
    [pending, updatePending, agentRef],
  );
}

/**
 * Runs a live turn's navigation once and holds its proposals for the member
 * to confirm. `live` is non-null only while this tab drives the turn, so an
 * action is only ever offered to the member who started it, in this tab.
 * Only items carrying the turn's nonce count: a block an agent copied from
 * a file or a web page cannot carry it.
 */
export function useWorkspaceActionDispatch(input: {
  workspaceId: string;
  chatId: string | null;
  live: Live | null;
}): {
  pending: PendingWorkspaceAction[];
  resolve(key: string, outcome: "done" | "dismissed", message?: string): void;
  outcomeFor(chatId: string, item: Gen2TurnItem): WorkspaceActionOutcome | null;
  announcement: string;
} {
  const { workspaceId, chatId, live } = input;
  const agent = useWorkspaceAgent();
  const agentRef = useRef(agent);
  useEffect(() => {
    agentRef.current = agent;
  });
  const [pending, updatePending] = usePendingActions(workspaceId, chatId);
  const announcement = useLiveActions(
    workspaceId,
    chatId,
    live,
    agentRef,
    updatePending,
  );
  const resolve = useResolve(pending, updatePending, agentRef);
  return {
    pending,
    resolve,
    outcomeFor: readWorkspaceActionOutcome,
    announcement,
  };
}

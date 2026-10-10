"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Gen2TurnItem, Gen2WorkspaceAction } from "@codev/contracts";

import { workspaceActionCopy } from "./workspace-action-copy";
import {
  planWorkspaceActions,
  type LiveWorkspaceTurn,
} from "./workspace-action-plan";
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

type Live = LiveWorkspaceTurn;

/** What this tab did with an action item, if anything; null when unknown. */
export function readWorkspaceActionOutcome(
  chatId: string,
  item: Gen2TurnItem,
): WorkspaceActionOutcome | null {
  if (item.kind !== "workspaceAction" || !item.action) return null;
  const { id: itemId, token, action } = item;
  return readStoredActionOutcome({ chatId, itemId, token, action });
}

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
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
  // A late result for another chat (the member switched) never lands here.
  const update = useCallback(
    (change: (current: StoredPendingAction[]) => StoredPendingAction[]) =>
      setState((current) => ({
        ...current,
        list: change(current.list).filter(
          (entry) => entry.chatId === current.chatId,
        ),
      })),
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
  writeStoredActionOutcome(entry, { state, message: message ?? fallback });
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
  // The chat each turn started in; the member may switch chats mid-turn.
  const turnChats = useRef(new Map<string, string>());
  const items = live?.items;
  const sessionId = live?.sessionId;
  const actionNonce = live?.actionNonce ?? null;
  useEffect(() => {
    const controller = agentRef.current?.controller;
    if (!items || !sessionId || !chatId || !controller) return;
    seen.current ??= new Set(readSeenActionKeys(workspaceId));
    const turnChat = turnChats.current.get(sessionId) ?? chatId;
    turnChats.current.set(sessionId, turnChat);
    const onScreen = turnChat === chatId;
    const next = planWorkspaceActions(
      { sessionId, actionNonce, items },
      { chatId: turnChat, onScreen },
      seen.current,
      controller,
    );
    next.seen.forEach((key) => seen.current?.add(key));
    rememberSeenActionKeys(workspaceId, next.seen);
    const { queued } = next;
    if (queued.length && !onScreen) {
      const stored = readPendingActions(workspaceId, turnChat);
      writePendingActions(workspaceId, turnChat, [...stored, ...queued]);
    } else if (queued.length) updatePending((list) => [...list, ...queued]);
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
      const ofTurn = (type: Gen2WorkspaceAction["type"]) =>
        pending.filter(
          (other) =>
            other.key !== key &&
            other.turn === entry.turn &&
            other.action.type === type,
        );
      // The preview waits for the last of the turn's commands (the server
      // usually comes after the installs), not the first one accepted.
      const linked =
        outcome === "done" &&
        entry.action.type === "run_in_terminal" &&
        !ofTurn("run_in_terminal").length
          ? ofTurn("open_preview")
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

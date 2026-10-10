"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Gen2TurnItem } from "@codev/contracts";

import {
  decodeAgentExecOutput,
  mergeAgentExecChunks,
  type AgentExecChunk,
} from "@/lib/gen2/agent-output";
import { finalizeGen2Turn, reduceGen2Turn } from "@/lib/gen2/turn-reducer";
import {
  readStoredChatTurn,
  rememberChatTurn,
  type StoredChatTurn,
} from "./chat-turn-storage";

type PollPayload = {
  chunks?: AgentExecChunk[];
  nextSequence?: number;
  exited?: boolean;
  exitCode?: number | null;
  error?: string;
  continuedAs?: string | null;
};

/** How a turn this tab drove ended, including any fallback re-runs. */
export type ChatTurnOutcome = {
  chatId: string;
  status: "completed" | "failed" | "stopped";
};

type DriveResult = {
  continuedAs: string | null;
  status: ChatTurnOutcome["status"];
};

type Progress = {
  chunks: AgentExecChunk[];
  after: number;
  sawFileChange: boolean;
};

async function pollTurn(
  workspaceId: string,
  turn: StoredChatTurn,
  after: number,
  signal: AbortSignal,
) {
  const response = await fetch(
    `/api/gen2/workspaces/${workspaceId}/agent/poll`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: turn.chatId,
        sessionId: turn.sessionId,
        after,
      }),
      signal,
    },
  );
  const payload = (await response.json().catch(() => ({}))) as PollPayload & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(payload.error ?? "That turn could not continue.");
  return payload;
}

function reducePoll(
  turn: StoredChatTurn,
  chunks: AgentExecChunk[],
  payload: PollPayload,
) {
  const state = reduceGen2Turn(turn.provider, decodeAgentExecOutput(chunks));
  return payload.exited
    ? finalizeGen2Turn(turn.provider, state, payload.exitCode ?? null)
    : state;
}

/**
 * Drives this tab's turn: polls the stream, re-reduces it into activity on
 * every poll, follows fallback re-runs, and rejoins a turn after a reload.
 */
export function useChatTurn({
  workspaceId,
  loadThread,
  loadChats,
  onFilesChanged,
  refreshProvider,
  setError,
  setChatId,
  onSettled,
}: {
  workspaceId: string;
  loadThread: (chatId: string) => Promise<void>;
  loadChats: () => Promise<void>;
  onFilesChanged: () => void;
  refreshProvider: () => Promise<void>;
  setError: (message: string) => void;
  setChatId: (chatId: string) => void;
  onSettled: (outcome: ChatTurnOutcome) => void;
}) {
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<Gen2TurnItem[]>([]);
  const [liveReply, setLiveReply] = useState("");
  const [live, setLive] = useState<StoredChatTurn | null>(null);
  const drivingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  });

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  const finish = useCallback(
    async (chatId: string, sawFileChange: boolean) => {
      drivingRef.current = false;
      abortRef.current = null;
      sessionRef.current = null;
      rememberChatTurn(workspaceId, null);
      // Swap the live bubble for the saved reply in one render; clearing it
      // first flashes "Thinking…" and then shows the reply a second time.
      await loadThread(chatId).catch(() => undefined);
      setRunning(false);
      setLive(null);
      setItems([]);
      setLiveReply("");
      await loadChats();
      if (sawFileChange) onFilesChanged();
    },
    [workspaceId, loadThread, loadChats, onFilesChanged],
  );

  /** Polls one session until it exits, rendering the stream as it grows. */
  const pollUntilExit = useCallback(
    async (turn: StoredChatTurn, progress: Progress, signal: AbortSignal) => {
      for (;;) {
        const payload = await pollTurn(
          workspaceId,
          turn,
          progress.after,
          signal,
        );
        progress.chunks = mergeAgentExecChunks(
          progress.chunks,
          Array.isArray(payload.chunks) ? payload.chunks : [],
        );
        progress.after = payload.nextSequence ?? progress.after;
        rememberChatTurn(workspaceId, { ...turn, after: progress.after });
        const state = reducePoll(turn, progress.chunks, payload);
        setItems(state.items);
        setLiveReply(state.reply);
        progress.sawFileChange ||= state.items.some(
          (item) => item.kind === "fileChange",
        );
        if (!payload.exited) continue;
        const continuedAs = payload.continuedAs ?? null;
        const failure = continuedAs ? "" : payload.error || state.error || "";
        if (failure) setError(failure);
        return {
          continuedAs,
          status: failure ? "failed" : "completed",
        } as const;
      }
    },
    [workspaceId, setError],
  );

  /** One session to its exit; resolves with any fallback re-run to follow. */
  const drive = useCallback(
    async (turn: StoredChatTurn): Promise<DriveResult | null> => {
      if (drivingRef.current) return null;
      drivingRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      sessionRef.current = turn.sessionId;
      setRunning(true);
      setLive(turn);
      // Remembered before the first poll, so a reload right away rejoins.
      rememberChatTurn(workspaceId, turn);
      const progress: Progress = {
        chunks: [],
        after: turn.after,
        sawFileChange: false,
      };
      try {
        return await pollUntilExit(turn, progress, controller.signal);
      } catch (cause) {
        if ((cause as Error)?.name === "AbortError")
          return { continuedAs: null, status: "stopped" };
        setError(cause instanceof Error ? cause.message : "That turn stopped.");
        void refreshProvider();
        return { continuedAs: null, status: "failed" };
      } finally {
        await finish(turn.chatId, progress.sawFileChange);
      }
    },
    [workspaceId, finish, pollUntilExit, refreshProvider, setError],
  );

  /** Drives a turn and any fallback re-runs the server chains onto it. */
  const follow = useCallback(
    async (turn: StoredChatTurn) => {
      let next: StoredChatTurn | null = turn;
      let status: ChatTurnOutcome["status"] = "completed";
      while (next) {
        const result = await drive(next);
        if (!result) return;
        status = result.status;
        next = result.continuedAs
          ? {
              ...next,
              sessionId: result.continuedAs,
              after: 0,
              actionNonce: null,
            }
          : null;
      }
      onSettledRef.current({ chatId: turn.chatId, status });
    },
    [drive],
  );

  // Rejoin a turn that was still running when the page reloaded.
  useEffect(() => {
    const timeout = setTimeout(() => {
      const stored = readStoredChatTurn(workspaceId);
      if (!stored) return;
      setChatId(stored.chatId);
      void follow(stored);
    }, 0);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function stop() {
    const session = sessionRef.current;
    abortRef.current?.abort();
    if (!session) return;
    await fetch(`/api/gen2/workspaces/${workspaceId}/agent`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session }),
    }).catch(() => undefined);
  }

  /** This tab's live turn, for the action dispatcher; null when idle. */
  const liveTurn = useMemo(
    () =>
      running && live
        ? { sessionId: live.sessionId, actionNonce: live.actionNonce, items }
        : null,
    [running, live, items],
  );

  return {
    running,
    items,
    liveReply,
    live: liveTurn,
    liveActionNonce: liveTurn?.actionNonce ?? null,
    follow,
    stop,
  };
}

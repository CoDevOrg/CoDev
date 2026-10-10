"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Gen2TurnItem } from "@codev/contracts";

import { pollChatTurnUntilExit, type ChatTurnProgress } from "./chat-turn-poll";
import {
  readStoredChatTurn,
  rememberChatTurn,
  type StoredChatTurn,
} from "./chat-turn-storage";

/** How a turn this tab drove ended, including any fallback re-runs. */
export type ChatTurnOutcome = {
  chatId: string;
  status: "completed" | "failed" | "stopped";
};

type DriveResult = {
  continuedAs: string | null;
  status: ChatTurnOutcome["status"];
};

type TurnInput = {
  workspaceId: string;
  loadThread: (chatId: string) => Promise<void>;
  loadChats: () => Promise<void>;
  onFilesChanged: () => void;
  refreshProvider: () => Promise<void>;
  setError: (message: string) => void;
  setChatId: (chatId: string) => void;
  onSettled: (outcome: ChatTurnOutcome) => void;
};

/** Rejoins a turn that was still running when the page reloaded. */
function useRejoin(
  workspaceId: string,
  setChatId: (chatId: string) => void,
  follow: (turn: StoredChatTurn) => Promise<void>,
) {
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
}

/** Follows a turn through any fallback re-runs the server chains onto it. */
async function followChain(
  turn: StoredChatTurn,
  drive: (turn: StoredChatTurn) => Promise<DriveResult | null>,
): Promise<ChatTurnOutcome | null> {
  let next: StoredChatTurn | null = turn;
  let status: ChatTurnOutcome["status"] = "completed";
  while (next) {
    const result = await drive(next);
    if (!result) return null;
    status = result.status;
    next = result.continuedAs
      ? { ...next, sessionId: result.continuedAs, after: 0, actionNonce: null }
      : null;
  }
  return { chatId: turn.chatId, status };
}

/** This tab's live turn: what it shows, and what the dispatcher reads. */
function useLiveTurn() {
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<Gen2TurnItem[]>([]);
  const [liveReply, setLiveReply] = useState("");
  const [turn, setTurn] = useState<StoredChatTurn | null>(null);
  const live = useMemo(
    () =>
      running && turn
        ? { sessionId: turn.sessionId, actionNonce: turn.actionNonce, items }
        : null,
    [running, turn, items],
  );
  function begin(next: StoredChatTurn) {
    setRunning(true);
    setTurn(next);
  }
  function end() {
    setRunning(false);
    setTurn(null);
    setItems([]);
    setLiveReply("");
  }
  return {
    state: { running, items, liveReply, live, chatId: turn?.chatId ?? null },
    sink: { setItems, setLiveReply },
    begin,
    end,
  };
}

/** The one session this tab drives: its abort signal, and Stop. */
function useTurnControl(workspaceId: string) {
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  return {
    /** A signal for a new session; null while another is being driven. */
    open(sessionId: string) {
      if (abortRef.current) return null;
      abortRef.current = new AbortController();
      sessionRef.current = sessionId;
      return abortRef.current.signal;
    },
    close() {
      abortRef.current = null;
      sessionRef.current = null;
    },
    async stop() {
      const session = sessionRef.current;
      abortRef.current?.abort();
      if (!session) return;
      await fetch(`/api/gen2/workspaces/${workspaceId}/agent`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session }),
      }).catch(() => undefined);
    },
  };
}

/**
 * Drives this tab's turn: polls the stream, re-reduces it into activity on
 * every poll, follows fallback re-runs, and rejoins a turn after a reload.
 */
export function useChatTurn(input: TurnInput) {
  const { workspaceId, setError } = input;
  const view = useLiveTurn();
  const control = useTurnControl(workspaceId);
  const onSettledRef = useRef(input.onSettled);
  useEffect(() => {
    onSettledRef.current = input.onSettled;
  });

  const finish = async (chatId: string, sawFileChange: boolean) => {
    control.close();
    rememberChatTurn(workspaceId, null);
    // Swap the live bubble for the saved reply in one render; clearing it
    // first flashes "Thinking…" and then shows the reply a second time.
    await input.loadThread(chatId).catch(() => undefined);
    view.end();
    await input.loadChats();
    if (sawFileChange) input.onFilesChanged();
  };

  /** One session to its exit; resolves with any fallback re-run to follow. */
  const drive = async (turn: StoredChatTurn): Promise<DriveResult | null> => {
    const signal = control.open(turn.sessionId);
    if (!signal) return null;
    view.begin(turn);
    // Remembered before the first poll, so a reload right away rejoins.
    rememberChatTurn(workspaceId, turn);
    const progress: ChatTurnProgress = {
      chunks: [],
      after: turn.after,
      sawFileChange: false,
    };
    const sink = { ...view.sink, setError };
    try {
      return await pollChatTurnUntilExit(
        workspaceId,
        turn,
        progress,
        signal,
        sink,
      );
    } catch (cause) {
      if ((cause as Error)?.name === "AbortError")
        return { continuedAs: null, status: "stopped" };
      setError(cause instanceof Error ? cause.message : "That turn stopped.");
      void input.refreshProvider();
      return { continuedAs: null, status: "failed" };
    } finally {
      await finish(turn.chatId, progress.sawFileChange);
    }
  };

  const driveRef = useRef(drive);
  useEffect(() => {
    driveRef.current = drive;
  });
  const follow = useCallback(async (turn: StoredChatTurn) => {
    const outcome = await followChain(turn, (next) => driveRef.current(next));
    if (outcome) onSettledRef.current(outcome);
  }, []);
  useRejoin(workspaceId, input.setChatId, follow);

  const { state } = view;
  return {
    ...state,
    /** The chat the live turn belongs to; null when idle. */
    liveChatId: state.live ? state.chatId : null,
    liveActionNonce: state.live?.actionNonce ?? null,
    follow,
    stop: control.stop,
  };
}

import type { Gen2TurnItem } from "@codev/contracts";

import {
  decodeAgentExecOutput,
  mergeAgentExecChunks,
  type AgentExecChunk,
} from "@/lib/gen2/agent-output";
import { finalizeGen2Turn, reduceGen2Turn } from "@/lib/gen2/turn-reducer";
import { rememberChatTurn, type StoredChatTurn } from "./chat-turn-storage";

type PollPayload = {
  chunks?: AgentExecChunk[];
  nextSequence?: number;
  exited?: boolean;
  exitCode?: number | null;
  error?: string;
  continuedAs?: string | null;
};

/** How far one session's stream has been read. */
export type ChatTurnProgress = {
  chunks: AgentExecChunk[];
  after: number;
  sawFileChange: boolean;
};

/** Where each poll's re-reduced activity goes. */
type TurnSink = {
  setItems: (items: Gen2TurnItem[]) => void;
  setLiveReply: (reply: string) => void;
  setError: (message: string) => void;
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
  const payload = (await response.json().catch(() => ({}))) as PollPayload;
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
 * Polls one session until it exits, re-reducing the whole stream into
 * activity on every poll and remembering how far it read, so a reload
 * rejoins where it left off. Resolves with any fallback re-run to follow.
 */
export async function pollChatTurnUntilExit(
  workspaceId: string,
  turn: StoredChatTurn,
  progress: ChatTurnProgress,
  signal: AbortSignal,
  sink: TurnSink,
) {
  for (;;) {
    const payload = await pollTurn(workspaceId, turn, progress.after, signal);
    progress.chunks = mergeAgentExecChunks(
      progress.chunks,
      Array.isArray(payload.chunks) ? payload.chunks : [],
    );
    progress.after = payload.nextSequence ?? progress.after;
    rememberChatTurn(workspaceId, { ...turn, after: progress.after });
    const state = reducePoll(turn, progress.chunks, payload);
    sink.setItems(state.items);
    sink.setLiveReply(state.reply);
    progress.sawFileChange ||= state.items.some(
      (item) => item.kind === "fileChange",
    );
    if (!payload.exited) continue;
    const continuedAs = payload.continuedAs ?? null;
    const failure = continuedAs ? "" : payload.error || state.error || "";
    if (failure) sink.setError(failure);
    return {
      continuedAs,
      status: failure ? "failed" : "completed",
    } as const;
  }
}

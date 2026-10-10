import "server-only";

import {
  gen2AgentProviderSchema,
  type Gen2AgentProviderName,
  type Gen2ChatMessage,
  type Gen2TurnItem,
  type Gen2TurnState,
} from "@codev/contracts";

import { logEvent } from "../platform/observability";
import { redisClient } from "./collaboration-redis";
import { reduceGen2Turn } from "./turn-reducer";
import { settleTurn } from "./turns";
import { syncAgentFiles } from "./turn-file-sync";
import { publishGen2WorkspaceEvent } from "./workspace-events";

/** One committed poll of a turn, ready to fan out to members' tabs. */
export interface Gen2TurnPoll {
  turn: {
    workspaceId: string;
    chatId: string;
    sessionId: string;
    userId: string;
    provider: string;
    worktreeId: string | null;
  };
  output: string;
  exited: boolean;
  exitCode: number | null;
  /** The reply the poll that ended the turn saved. */
  message: Gen2ChatMessage | null;
}

const PROGRESS_INTERVAL_MS = 1_000;
const MAX_PROGRESS_BYTES = 48 * 1_024;

const tail = (text: string, length: number) =>
  text.length > length ? `…${text.slice(-length)}` : text;

function compactItem(item: Gen2TurnItem, textLimit: number): Gen2TurnItem {
  if (item.kind === "command")
    return { ...item, output: tail(item.output, textLimit) };
  if (item.kind === "reasoning" || item.kind === "message")
    return { ...item, text: tail(item.text, textLimit * 2) };
  return item;
}

/** Recent activity and the reply's tail, small enough for one socket frame. */
export function compactTurnProgress(state: Gen2TurnState) {
  for (const [count, textLimit, replyLimit] of [
    [80, 1_000, 32_000],
    [20, 300, 16_000],
    [5, 120, 8_000],
  ] as const) {
    const items = state.items
      .slice(-count)
      .map((item) => compactItem(item, textLimit));
    const reply = tail(state.reply, replyLimit - 1);
    const truncated =
      items.length < state.items.length || reply.length < state.reply.length;
    if (JSON.stringify({ items, reply }).length <= MAX_PROGRESS_BYTES)
      return { items, reply, truncated };
  }
  return { items: [], reply: "", truncated: true };
}

/** At most one progress push per turn per interval, across instances. */
async function claimProgressSlot(sessionId: string) {
  const claimed = await redisClient().set(
    `codev:turn:${sessionId}:progress`,
    "1",
    "PX",
    PROGRESS_INTERVAL_MS,
    "NX",
  );
  return claimed === "OK";
}

function changedPaths(state: Gen2TurnState) {
  const paths = state.items.flatMap((item) =>
    item.kind === "fileChange" ? item.changes.map((change) => change.path) : [],
  );
  return [...new Set(paths)].slice(0, 200);
}

async function broadcastPoll(
  poll: Gen2TurnPoll,
  provider: Gen2AgentProviderName,
) {
  const { turn } = poll;
  const ref = {
    chatId: turn.chatId,
    sessionId: turn.sessionId,
    userId: turn.userId,
    provider,
  };
  const state = poll.exited
    ? settleTurn(turn, poll.output, poll.exitCode)
    : reduceGen2Turn(provider, poll.output);
  await syncAgentFiles(poll, provider, state);
  if (poll.exited) {
    await publishGen2WorkspaceEvent(turn.workspaceId, {
      kind: "turn.settled",
      ...ref,
      status: state.status === "running" ? "failed" : state.status,
      message: poll.message,
      changedPaths: changedPaths(state),
    });
  } else if (await claimProgressSlot(turn.sessionId)) {
    await publishGen2WorkspaceEvent(turn.workspaceId, {
      kind: "turn.progress",
      ...ref,
      ...compactTurnProgress(state),
    });
  }
}

/**
 * Fans committed turn polls out to members: live progress, the settled
 * reply, files the agent changed and where the agent is. Call it after the
 * poll's transaction commits. It never throws into the poller.
 */
export async function broadcastGen2TurnPolls(polls: Gen2TurnPoll[]) {
  for (const poll of polls) {
    const provider = gen2AgentProviderSchema.safeParse(poll.turn.provider);
    if (!provider.success) continue;
    await broadcastPoll(poll, provider.data).catch((error) =>
      logEvent("warn", "gen2.realtime.turn_broadcast_failed", {
        sessionId: poll.turn.sessionId,
        detail: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
}

/** Announces a new turn so every member's chat shows it running. */
export async function announceGen2TurnStarted(input: {
  workspaceId: string;
  chatId: string;
  sessionId: string;
  userId: string;
  provider: Gen2AgentProviderName;
  worktreeId?: string | null | undefined;
}) {
  await publishGen2WorkspaceEvent(input.workspaceId, {
    kind: "turn.started",
    chatId: input.chatId,
    sessionId: input.sessionId,
    userId: input.userId,
    provider: input.provider,
    worktreeId: input.worktreeId ?? null,
    startedAt: new Date().toISOString(),
  });
}

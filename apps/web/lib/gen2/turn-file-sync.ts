import "server-only";

import { eq } from "drizzle-orm";
import type {
  CollaborationUser,
  Gen2AgentProviderName,
  Gen2RealtimeActor,
  Gen2TurnState,
} from "@codev/contracts";
import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { redisClient } from "./collaboration-redis";
import {
  gen2CollaborationRoom,
  reconcileGen2CollaborationPaths,
} from "./collaboration-events";
import {
  readAgentPresence,
  removeAgentPresence,
  setAgentPresence,
} from "./collaboration-presence";
import { publishGen2FilesChanged } from "./workspace-events";
import type { Gen2TurnPoll } from "./turn-broadcast";

const SEEN_TTL_SECONDS = 60 * 60;
/** An agent with nothing new still refreshes its presence this often. */
const PRESENCE_REFRESH_MS = 30_000;

type Change = { key: string; path: string };

function fileChanges(state: Gen2TurnState): Change[] {
  return state.items.flatMap((item) =>
    item.kind === "fileChange"
      ? item.changes.map((change) => ({
          key: `${item.id}|${change.path}`,
          path: change.path,
        }))
      : [],
  );
}

/** The file-change items this poll is the first to see, across pollers. */
async function claimNewChanges(sessionId: string, changes: Change[]) {
  if (!changes.length) return [];
  const key = `codev:turn:${sessionId}:files`;
  const client = redisClient();
  const seen = await client.smismember(key, ...changes.map((c) => c.key));
  const fresh = changes.filter((_, index) => !seen[index]);
  if (fresh.length) {
    await client
      .multi()
      .sadd(key, ...fresh.map((change) => change.key))
      .expire(key, SEEN_TTL_SECONDS)
      .exec();
  }
  return fresh;
}

async function turnOwner(userId: string): Promise<CollaborationUser | null> {
  const [owner] = await getDatabase()
    .select({
      id: schema.users.id,
      login: schema.users.login,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return owner ?? null;
}

/**
 * Brings open editors up to date with what the agent just wrote (mid-turn,
 * in the turn's own worktree), tells file trees, and places the agent's
 * cursor at its latest edit. When the turn ends, the agent leaves.
 */
export async function syncAgentFiles(
  poll: Gen2TurnPoll,
  provider: Gen2AgentProviderName,
  state: Gen2TurnState,
) {
  const { turn } = poll;
  const worktreeId = turn.worktreeId ?? "main";
  const room = gen2CollaborationRoom(turn.workspaceId);
  const actor: Gen2RealtimeActor = {
    kind: "agent",
    sessionId: turn.sessionId,
    provider,
    ownerUserId: turn.userId,
    chatId: turn.chatId,
  };
  const changes = fileChanges(state);
  const fresh = await claimNewChanges(turn.sessionId, changes);
  const freshPaths = [...new Set(fresh.map((change) => change.path))];
  // At the end, settle every file: a mid-turn reconcile may have been skipped.
  const reconcile = poll.exited
    ? [...new Set(changes.map((change) => change.path))]
    : freshPaths;
  const ranges = reconcile.length
    ? await reconcileGen2CollaborationPaths({
        workspaceId: turn.workspaceId,
        userId: turn.userId,
        worktreeId,
        paths: reconcile,
        actor,
      })
    : new Map<string, { from: number; to: number }>();
  if (freshPaths.length)
    await publishGen2FilesChanged(
      turn.workspaceId,
      worktreeId,
      freshPaths,
      actor,
    );
  if (poll.exited) return removeAgentPresence(room, turn.sessionId);
  await placeAgent(poll, actor, freshPaths.at(-1) ?? null, ranges);
}

/** Puts the agent at its latest edit, or keeps its presence alive. */
async function placeAgent(
  poll: Gen2TurnPoll,
  actor: Extract<Gen2RealtimeActor, { kind: "agent" }>,
  latestPath: string | null,
  ranges: Map<string, { from: number; to: number }>,
) {
  const { turn } = poll;
  const room = gen2CollaborationRoom(turn.workspaceId);
  const previous = await readAgentPresence(room, turn.sessionId);
  const stale =
    !previous ||
    Date.now() - Date.parse(previous.lastSeenAt) > PRESENCE_REFRESH_MS;
  if (!latestPath && !stale) return;
  const path = latestPath ?? previous?.path ?? null;
  const range = path ? ranges.get(path) : undefined;
  const user = previous?.user ?? (await turnOwner(turn.userId));
  if (!user) return;
  await setAgentPresence(room, {
    user,
    path,
    cursor: range
      ? { anchor: range.to, head: range.to }
      : previous?.path === path
        ? (previous?.cursor ?? null)
        : null,
    worktreeId: turn.worktreeId ?? "main",
    agent: {
      sessionId: turn.sessionId,
      provider: actor.provider,
      chatId: turn.chatId,
    },
    view: path ? "files" : "chat",
    chatId: turn.chatId,
    away: false,
  });
}

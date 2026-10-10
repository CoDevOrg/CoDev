import "server-only";

import { and, eq } from "drizzle-orm";
import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { pollGen2AgentTurn } from "./agent";
import { Gen2AccessError } from "./errors";
import { requireGen2Member } from "./workspaces";

/** A turn whose own poller has written nothing for this long needs a driver. */
const QUIET_MS = 15_000;

/**
 * Polls a running turn on behalf of the member who started it, so output,
 * the reply and agent edits keep reaching everyone after that member's tab
 * closes. The poll runs as the turn's owner, exactly as the ARM cron does;
 * the caller only needs edit access. Returns whether a poll ran.
 */
export async function driveGen2AgentTurn(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
}) {
  const membership = await requireGen2Member(input.workspaceId, input.userId);
  if (membership.role === "viewer")
    throw new Gen2AccessError("Viewers cannot run agent turns.", 403);
  const [turn] = await getDatabase()
    .select({
      userId: schema.gen2AgentTurns.userId,
      nextSequence: schema.gen2AgentTurns.nextSequence,
      exited: schema.gen2AgentTurns.exited,
      updatedAt: schema.gen2AgentTurns.updatedAt,
    })
    .from(schema.gen2AgentTurns)
    .where(
      and(
        eq(schema.gen2AgentTurns.sessionId, input.sessionId),
        eq(schema.gen2AgentTurns.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!turn) throw new Gen2AccessError("This turn could not be found.", 404);
  if (turn.exited || Date.now() - turn.updatedAt.getTime() < QUIET_MS)
    return false;
  await pollGen2AgentTurn({
    workspaceId: input.workspaceId,
    userId: turn.userId,
    sessionId: input.sessionId,
    after: turn.nextSequence,
  });
  return true;
}

import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { schema } from "@codev/db";
import { getDatabase } from "../platform/database";
import { pollCodexExecInSandbox } from "../runtime/orchestrator-codex-exec";
import { recordGen2TurnChunks } from "./turns";
import { Gen2LifecycleError } from "./errors";

type Turn = typeof schema.gen2AgentTurns.$inferSelect;
type Transaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0];
type Poll = Awaited<ReturnType<typeof pollCodexExecInSandbox>> & {
  persisted: Awaited<ReturnType<typeof recordGen2TurnChunks>>;
};

function history(turn: Turn, after: number) {
  if (after >= turn.nextSequence || !turn.output) return [];
  const bytes = Buffer.concat([
    Buffer.from(turn.output),
    Buffer.from(turn.pendingBase64, "base64"),
  ]);
  return [
    {
      sequence: Math.max(0, turn.nextSequence - 1),
      dataBase64: bytes.toString("base64"),
    },
  ];
}

async function savedPoll(
  transaction: Transaction,
  turn: Turn,
  after: number,
): Promise<Poll> {
  const [message] = turn.replyMessageId
    ? await transaction
        .select({ body: schema.gen2ChatMessages.body })
        .from(schema.gen2ChatMessages)
        .where(eq(schema.gen2ChatMessages.id, turn.replyMessageId))
        .limit(1)
    : [];
  return {
    chunks: history(turn, after),
    nextSequence: turn.nextSequence,
    exited: turn.exited,
    exitCode: turn.exited ? 0 : null,
    persisted:
      message && turn.replyMessageId
        ? { reply: message.body, messageId: turn.replyMessageId }
        : null,
  };
}

async function drain(
  transaction: Transaction,
  turn: Turn,
  after: number,
): Promise<Poll> {
  const result = await pollCodexExecInSandbox(
    turn.workspaceId,
    turn.sessionId,
    turn.nextSequence,
  );
  const chunks = result.chunks.filter(
    (chunk) => chunk.sequence >= turn.nextSequence,
  );
  // The guest returns at most 128 chunks. Never acknowledge its undispatched tail.
  const nextSequence =
    chunks.at(-1)?.sequence === undefined
      ? turn.nextSequence
      : chunks.at(-1)!.sequence + 1;
  const exited = result.exited && nextSequence >= result.nextSequence;
  const persisted = await recordGen2TurnChunks(
    {
      sessionId: turn.sessionId,
      chunks,
      exited,
      exitCode: result.exitCode,
      nextSequence,
    },
    transaction,
  );
  return {
    ...result,
    chunks: [...history(turn, after), ...chunks],
    nextSequence,
    exited,
    persisted,
  };
}

/** Browser and cron pollers share a durable cursor and a nonblocking claim. */
export async function pollPersistedArmTurn(input: {
  workspaceId: string;
  sessionId: string;
  after: number;
}): Promise<Poll> {
  return getDatabase().transaction(async (transaction) => {
    const claim = await transaction.execute(
      sql`select pg_try_advisory_xact_lock(hashtext(${`codev-arm-turn:${input.sessionId}`})) as locked`,
    );
    const [turn] = await transaction
      .select()
      .from(schema.gen2AgentTurns)
      .where(
        and(
          eq(schema.gen2AgentTurns.sessionId, input.sessionId),
          eq(schema.gen2AgentTurns.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    if (!turn)
      throw new Gen2LifecycleError("This turn could not be found.", 404);
    if (turn.exited || claim.rows[0]?.locked !== true)
      return savedPoll(transaction, turn, input.after);
    return drain(transaction, turn, input.after);
  });
}

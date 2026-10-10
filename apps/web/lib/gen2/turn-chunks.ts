import "server-only";

import { and, eq } from "drizzle-orm";
import type { Gen2ChatMessage } from "@codev/contracts";
import { schema } from "@codev/db";
import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import { appendGen2ChatMessage } from "./chats";
import {
  decodeAgentExecStream,
  decodePendingBytes,
  encodePendingBytes,
  type AgentExecChunk,
} from "./agent-output";
import { capTurnOutput, settleTurn } from "./turns";
import {
  cliModelRequirement,
  type CliModelRequirement,
} from "./agent-cli-fallback";
import { broadcastGen2TurnPolls, type Gen2TurnPoll } from "./turn-broadcast";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Turn = typeof schema.gen2AgentTurns.$inferSelect;
type Input = {
  sessionId: string;
  chunks: AgentExecChunk[];
  exited: boolean;
  exitCode: number | null;
  nextSequence?: number;
};

async function savePoll(
  database: Database | Transaction,
  input: Input,
  output: string,
  pending: Uint8Array,
) {
  const [saved] = await database
    .update(schema.gen2AgentTurns)
    .set({
      output,
      pendingBase64: input.exited ? "" : encodePendingBytes(pending),
      exited: input.exited,
      updatedAt: new Date(),
      ...(input.nextSequence === undefined
        ? {}
        : { nextSequence: input.nextSequence }),
    })
    .where(
      and(
        eq(schema.gen2AgentTurns.sessionId, input.sessionId),
        eq(schema.gen2AgentTurns.exited, false),
      ),
    )
    .returning({ sessionId: schema.gen2AgentTurns.sessionId });
  return Boolean(saved);
}

async function persistReply(
  database: Database | Transaction,
  turn: Turn,
  input: Input,
  output: string,
  transaction?: Transaction,
) {
  const state = settleTurn(turn, output, input.exitCode);
  // A CLI too old for the model is not the member's failure: after this commits,
  // the poller re-runs the turn on a fallback model and writes the note.
  const cliRequirement = turn.model
    ? cliModelRequirement(turn.provider, state.error)
    : null;
  if (cliRequirement) return { reply: "", messageId: null, cliRequirement };
  const body = state.reply || state.error || "";
  const message = body
    ? await appendGen2ChatMessage(
        { chatId: turn.chatId, role: "assistant", body, items: state.items },
        transaction,
      )
    : null;
  if (!message) return null;
  await database
    .update(schema.gen2AgentTurns)
    .set({ replyMessageId: message.id })
    .where(eq(schema.gen2AgentTurns.sessionId, input.sessionId));
  return { reply: message.body, messageId: message.id, message };
}

function turnPoll(
  turn: Turn,
  input: Input,
  output: string,
  message: Gen2ChatMessage | null,
): Gen2TurnPoll {
  return {
    turn: {
      workspaceId: turn.workspaceId,
      chatId: turn.chatId,
      sessionId: turn.sessionId,
      userId: turn.userId,
      provider: turn.provider,
      worktreeId: turn.worktreeId,
    },
    output,
    exited: input.exited,
    exitCode: input.exitCode,
    message,
  };
}

/**
 * Commit output and its acknowledgement together when the ARM poller supplies
 * a transaction; that poller then broadcasts `sink` after it commits.
 */
export async function recordGen2TurnChunks(
  input: Input,
  transaction?: Transaction,
  sink?: Gen2TurnPoll[],
): Promise<{
  reply: string;
  messageId: string | null;
  cliRequirement?: CliModelRequirement;
} | null> {
  try {
    const database = transaction ?? getDatabase();
    const [turn] = await database
      .select()
      .from(schema.gen2AgentTurns)
      .where(eq(schema.gen2AgentTurns.sessionId, input.sessionId))
      .limit(1);
    if (!turn || turn.exited) return null;
    const decoded = decodeAgentExecStream(
      decodePendingBytes(turn.pendingBase64),
      input.chunks,
    );
    const output = capTurnOutput(turn.output + decoded.text);
    if (!(await savePoll(database, input, output, decoded.pending)))
      return null;
    const persisted = input.exited
      ? await persistReply(database, turn, input, output, transaction)
      : null;
    const poll = turnPoll(turn, input, output, persisted?.message ?? null);
    if (transaction) sink?.push(poll);
    else await broadcastGen2TurnPolls([poll]);
    if (!persisted || !("message" in persisted)) return persisted;
    return { reply: persisted.reply, messageId: persisted.messageId };
  } catch (error) {
    logEvent("error", "gen2.turn.record_failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    if (transaction) throw error;
    return null;
  }
}

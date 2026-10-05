import "server-only";

import { and, eq } from "drizzle-orm";
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
import { reconcileGen2CollaborationPaths } from "./collaboration-events";

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

async function reconcilePaths(
  turn: Turn,
  state: ReturnType<typeof settleTurn>,
) {
  const paths = state.items.flatMap((item) =>
    item.kind === "fileChange" ? item.changes.map((change) => change.path) : [],
  );
  if (!paths.length) return;
  await reconcileGen2CollaborationPaths({
    workspaceId: turn.workspaceId,
    userId: turn.userId,
    paths,
  }).catch((error) => {
    logEvent("error", "gen2.collaboration.reconcile_failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
  });
}

async function persistReply(
  database: Database | Transaction,
  turn: Turn,
  input: Input,
  output: string,
  transaction?: Transaction,
) {
  const state = settleTurn(turn, output, input.exitCode);
  await reconcilePaths(turn, state);
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
  return { reply: message.body, messageId: message.id };
}

/** Commit output and its acknowledgement together when the ARM poller supplies a transaction. */
export async function recordGen2TurnChunks(
  input: Input,
  transaction?: Transaction,
): Promise<{ reply: string; messageId: string } | null> {
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
    if (
      !(await savePoll(database, input, output, decoded.pending)) ||
      !input.exited
    )
      return null;
    return await persistReply(database, turn, input, output, transaction);
  } catch (error) {
    logEvent("error", "gen2.turn.record_failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    if (transaction) throw error;
    return null;
  }
}

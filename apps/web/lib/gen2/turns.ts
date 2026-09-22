import "server-only";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";
import type { Gen2ProviderId } from "@codev/contracts";

import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import { appendGen2ChatMessage } from "./chats";
import { Gen2AccessError } from "./errors";
import {
  decodeCodexExecStream,
  decodePendingBytes,
  encodePendingBytes,
  type CodexExecChunk,
} from "./codex-output";
import { reduceCodexTurn } from "./turn-events";

/**
 * Server-side accumulation of a running Codex turn.
 *
 * The guest discards output as soon as a poll acknowledges it, so the
 * transcript exists only in whatever the poller keeps. Keeping it here rather
 * than in the browser is what makes a reply survive a closed tab, and what
 * lets the other members of a shared workspace see the turn at all.
 */

/**
 * Command output is unbounded (a test suite, a `cat` of something large).
 * Keep the head and the tail: the head has the reasoning and the commands,
 * the tail has the reply, and the middle is what a human would skim past.
 */
export const GEN2_TURN_OUTPUT_LIMIT = 1_000_000;

export function capTurnOutput(output: string): string {
  if (output.length <= GEN2_TURN_OUTPUT_LIMIT) return output;
  const half = Math.floor(GEN2_TURN_OUTPUT_LIMIT / 2);
  return `${output.slice(0, half)}\n…\n${output.slice(-half)}`;
}

export async function createGen2Turn(input: {
  sessionId: string;
  workspaceId: string;
  chatId: string;
  userId: string;
  provider?: Gen2ProviderId;
}) {
  await getDatabase()
    .insert(schema.gen2AgentTurns)
    .values(input)
    .onConflictDoNothing();
}

/**
 * Finds a turn only within the requested workspace. The caller's workspace
 * capability is checked separately; this prevents a session id from being a
 * cross-workspace authority and supplies the immutable initiating user for
 * credential cleanup and cancellation policy.
 */
export async function requireGen2Turn(workspaceId: string, sessionId: string) {
  const [turn] = await getDatabase()
    .select({
      workspaceId: schema.gen2AgentTurns.workspaceId,
      chatId: schema.gen2AgentTurns.chatId,
      userId: schema.gen2AgentTurns.userId,
      provider: schema.gen2AgentTurns.provider,
      exited: schema.gen2AgentTurns.exited,
    })
    .from(schema.gen2AgentTurns)
    .where(
      and(
        eq(schema.gen2AgentTurns.workspaceId, workspaceId),
        eq(schema.gen2AgentTurns.sessionId, sessionId),
      ),
    )
    .limit(1);
  if (!turn) {
    throw new Gen2AccessError("Turn not found.");
  }
  return turn;
}

/**
 * Appends a poll's chunks and, once the process exits, writes the assistant
 * message. Returns the reply when it persisted one.
 *
 * Every failure here is swallowed and logged: a turn that is streaming fine
 * must not die because its transcript could not be saved.
 */
export async function recordGen2TurnChunks(input: {
  sessionId: string;
  chunks: CodexExecChunk[];
  exited: boolean;
}): Promise<{ reply: string; messageId: string } | null> {
  try {
    const database = getDatabase();
    const [turn] = await database
      .select()
      .from(schema.gen2AgentTurns)
      .where(eq(schema.gen2AgentTurns.sessionId, input.sessionId))
      .limit(1);
    if (!turn || turn.exited) return null;

    const decoded = decodeCodexExecStream(
      decodePendingBytes(turn.pendingBase64),
      input.chunks,
    );
    const output = capTurnOutput(turn.output + decoded.text);

    if (!input.exited) {
      await database
        .update(schema.gen2AgentTurns)
        .set({
          output,
          pendingBase64: encodePendingBytes(decoded.pending),
          updatedAt: new Date(),
        })
        .where(eq(schema.gen2AgentTurns.sessionId, input.sessionId));
      return null;
    }

    const state = reduceCodexTurn(output);
    const body = state.reply || state.error || "";
    const message = body
      ? await appendGen2ChatMessage({
          chatId: turn.chatId,
          role: "assistant",
          body,
          items: state.items,
          provider: turn.provider,
        })
      : null;
    await database
      .update(schema.gen2AgentTurns)
      .set({
        output,
        pendingBase64: "",
        exited: true,
        replyMessageId: message?.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.gen2AgentTurns.sessionId, input.sessionId));
    return message ? { reply: message.body, messageId: message.id } : null;
  } catch (error) {
    logEvent("error", "gen2.turn.record_failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

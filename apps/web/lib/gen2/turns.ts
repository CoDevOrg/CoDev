import "server-only";

import { eq } from "drizzle-orm";

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
import { reduceGen2Turn } from "./turn-reducer";
import type { SupersetAgentPollChunk } from "./superset-agent-orchestrator-client";
import { reconcileGen2CollaborationPaths } from "./collaboration-events";

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
}) {
  await getDatabase()
    .insert(schema.gen2AgentTurns)
    .values(input)
    .onConflictDoNothing();
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
  chunks: AgentExecChunk[];
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

    const decoded = decodeAgentExecStream(
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

    const state = reduceGen2Turn(output);
    const changedPaths = state.items.flatMap((item) =>
      item.kind === "fileChange"
        ? item.changes.map((change) => change.path)
        : [],
    );
    if (changedPaths.length > 0) {
      await reconcileGen2CollaborationPaths({
        workspaceId: turn.workspaceId,
        userId: turn.userId,
        paths: changedPaths,
      }).catch((error) => {
        logEvent("error", "gen2.collaboration.reconcile_failed", {
          detail: error instanceof Error ? error.message : "unknown",
        });
      });
    }
    const body = state.reply || state.error || "";
    const message = body
      ? await appendGen2ChatMessage({
          chatId: turn.chatId,
          role: "assistant",
          body,
          items: state.items,
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

/**
 * Same accumulation as `recordGen2TurnChunks`, for a Superset terminal-agent
 * run instead of a direct `codex exec` sandbox session (Superset Agent
 * Session Plan Phase 4). Uses the run's `hostAgentSessionId` as the
 * `gen2AgentTurns.sessionId` key -- that column is a bare `text` primary key,
 * not tied to the `codex exec` sandbox session format.
 *
 * Superset's poll snapshots the whole terminal buffer on every change (see
 * `vendor/superset/.../codev/agents.ts`'s `/poll` route) rather than
 * streaming an incremental append, so each chunk here already is the
 * complete current text -- it *replaces* `turn.output` instead of extending
 * it. `reduceCodexTurn` re-parses the whole accumulated text on every call by
 * design (see turn-events.ts), so replaying the same `codex exec --json`
 * lines inside a growing snapshot still yields stable item ids and the same
 * reply.
 */
export async function recordGen2SupersetRunOutput(input: {
  sessionId: string;
  chunks: SupersetAgentPollChunk[];
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

    const latest = [...input.chunks].sort(
      (left, right) => left.sequence - right.sequence,
    );
    const output = latest.length
      ? capTurnOutput(latest[latest.length - 1]!.data)
      : turn.output;

    if (!input.exited) {
      if (output === turn.output) return null;
      await database
        .update(schema.gen2AgentTurns)
        .set({ output, updatedAt: new Date() })
        .where(eq(schema.gen2AgentTurns.sessionId, input.sessionId));
      return null;
    }

    const state = reduceGen2Turn(output);
    const changedPaths = state.items.flatMap((item) =>
      item.kind === "fileChange"
        ? item.changes.map((change) => change.path)
        : [],
    );
    if (changedPaths.length > 0) {
      await reconcileGen2CollaborationPaths({
        workspaceId: turn.workspaceId,
        userId: turn.userId,
        paths: changedPaths,
      }).catch((error) => {
        logEvent("error", "gen2.collaboration.reconcile_failed", {
          detail: error instanceof Error ? error.message : "unknown",
        });
      });
    }
    const body = state.reply || state.error || "";
    const message = body
      ? await appendGen2ChatMessage({
          chatId: turn.chatId,
          role: "assistant",
          body,
          items: state.items,
        })
      : null;
    await database
      .update(schema.gen2AgentTurns)
      .set({
        output,
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

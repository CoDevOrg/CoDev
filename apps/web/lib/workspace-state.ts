import "server-only";

import { and, eq, sql } from "drizzle-orm";
import * as Y from "yjs";

import { agentEventSchema, type AgentEvent } from "@codev/shared-types";
import { schema } from "@codev/db";

import { getDatabase } from "./database";
import { recordWorkspaceHeartbeat } from "./heartbeat";

/**
 * The workspace state document is the durable, binary CRDT journal for UI
 * events. File documents remain separate (`workspace:<id>:<path>`); this
 * document holds prompts, tool cards, proposed diffs, and terminal events so
 * the UI can be rehydrated without a running sandbox.
 */
export function workspaceStateDocumentName(workspaceId: string) {
  return `workspace:${workspaceId}:state`;
}

const EVENTS_MAP = "events";

function stateFromBytes(state: Uint8Array | Buffer | null | undefined) {
  const document = new Y.Doc();
  if (state && state.byteLength > 0) {
    Y.applyUpdate(document, new Uint8Array(state), "postgres");
  }
  return document;
}

/** Pure helper used by tests and by the database writer. */
export function encodeWorkspaceStateEvents(events: AgentEvent[]) {
  const document = new Y.Doc();
  const map = document.getMap<string>(EVENTS_MAP);
  document.transact(() => {
    for (const event of events) {
      map.set(event.id, JSON.stringify(event));
    }
  }, "workspace-state");
  return Y.encodeStateAsUpdate(document);
}

/** Decode the binary CRDT journal into canonical events in display order. */
export function decodeWorkspaceStateEvents(state: Uint8Array | Buffer) {
  const document = stateFromBytes(state);
  const map = document.getMap<string>(EVENTS_MAP);
  return [...map.values()]
    .flatMap((value) => {
      try {
        const event = agentEventSchema.safeParse(JSON.parse(value));
        return event.success ? [event.data] : [];
      } catch {
        return [];
      }
    })
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp || left.id.localeCompare(right.id),
    );
}

/**
 * Append one canonical event to the workspace CRDT. The advisory transaction
 * lock serializes the read/merge/write cycle across Vercel instances so two
 * concurrent updates cannot overwrite one another's binary state.
 */
export async function appendWorkspaceStateEvent(event: AgentEvent) {
  await getDatabase().transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`workspace-state:${event.workspaceId}`}))`,
    );

    const documentName = workspaceStateDocumentName(event.workspaceId);
    const [stored] = await transaction
      .select({ state: schema.workspaceStateDocuments.state })
      .from(schema.workspaceStateDocuments)
      .where(
        and(
          eq(schema.workspaceStateDocuments.documentName, documentName),
          eq(schema.workspaceStateDocuments.workspaceId, event.workspaceId),
        ),
      )
      .limit(1);

    const document = stateFromBytes(stored?.state);
    const map = document.getMap<string>(EVENTS_MAP);
    if (map.has(event.id)) return;
    document.transact(() => {
      map.set(event.id, JSON.stringify(event));
    }, "workspace-state");

    const state = Buffer.from(Y.encodeStateAsUpdate(document));
    await transaction
      .insert(schema.workspaceStateDocuments)
      .values({
        documentName,
        workspaceId: event.workspaceId,
        state,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.workspaceStateDocuments.documentName,
        set: { state, updatedAt: new Date() },
      });
  });

  // Agent and terminal activity must keep the workspace alive even when no
  // browser tab is sending its periodic heartbeat. The event is already
  // durable, so a transient heartbeat failure must not make the activity
  // request fail after the state write succeeded.
  if (event.type !== "AGENT_THOUGHT") {
    await recordWorkspaceHeartbeat(event.workspaceId).catch(() => undefined);
  }
}

export async function readWorkspaceStateEvents(workspaceId: string) {
  const documentName = workspaceStateDocumentName(workspaceId);
  const [stored] = await getDatabase()
    .select({ state: schema.workspaceStateDocuments.state })
    .from(schema.workspaceStateDocuments)
    .where(
      and(
        eq(schema.workspaceStateDocuments.documentName, documentName),
        eq(schema.workspaceStateDocuments.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return stored ? decodeWorkspaceStateEvents(stored.state) : [];
}

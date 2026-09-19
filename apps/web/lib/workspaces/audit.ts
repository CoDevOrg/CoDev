import "server-only";

import { and, desc, eq, lt, sql } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { publishWorkspaceRealtimeEvent } from "./workspace-realtime";

function realtimeTypeForAuditEvent(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized === "presence.cursor.changed") {
    return "presence.cursor.changed";
  }
  if (normalized.startsWith("presence.")) return "presence.changed";
  if (
    normalized.startsWith("agent.") ||
    normalized.startsWith("shared_session.")
  ) {
    return "agents.changed";
  }
  if (
    normalized.startsWith("claim.") ||
    normalized.startsWith("coordination.") ||
    normalized.startsWith("brain.")
  ) {
    return "coordination.changed";
  }
  if (
    normalized.startsWith("workspace.member.") ||
    normalized.startsWith("workspace_member_")
  ) {
    return "team.changed";
  }
  return "activity.changed";
}

export async function appendWorkspaceEvent(input: {
  workspaceId: string;
  actorId?: string | null;
  type: string;
  payload?: Record<string, unknown>;
}) {
  const event = await getDatabase().transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${input.workspaceId}))`,
    );
    const [latest] = await transaction
      .select({ sequence: schema.workspaceEvents.sequence })
      .from(schema.workspaceEvents)
      .where(eq(schema.workspaceEvents.workspaceId, input.workspaceId))
      .orderBy(desc(schema.workspaceEvents.sequence))
      .limit(1);
    const [event] = await transaction
      .insert(schema.workspaceEvents)
      .values({
        workspaceId: input.workspaceId,
        sequence: (latest?.sequence ?? 0) + 1,
        type: input.type,
        actorId: input.actorId ?? null,
        payload: input.payload ?? {},
      })
      .returning();
    return event;
  });
  if (!event) throw new Error("Workspace event was not persisted.");
  void publishWorkspaceRealtimeEvent(
    input.workspaceId,
    realtimeTypeForAuditEvent(input.type),
    { sequence: event.sequence, sourceType: input.type },
  );
  return event;
}

export async function listWorkspaceEvents(
  workspaceId: string,
  userId: string,
  limit = 100,
  beforeSequence?: number,
) {
  return getDatabase()
    .select({
      id: schema.workspaceEvents.id,
      sequence: schema.workspaceEvents.sequence,
      type: schema.workspaceEvents.type,
      actorId: schema.workspaceEvents.actorId,
      payload: schema.workspaceEvents.payload,
      createdAt: schema.workspaceEvents.createdAt,
    })
    .from(schema.workspaceEvents)
    .innerJoin(
      schema.workspaceMembers,
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    )
    .where(
      and(
        eq(schema.workspaceEvents.workspaceId, workspaceId),
        typeof beforeSequence === "number"
          ? lt(schema.workspaceEvents.sequence, beforeSequence)
          : undefined,
      ),
    )
    .orderBy(desc(schema.workspaceEvents.sequence))
    .limit(Math.min(Math.max(limit, 1), 100));
}

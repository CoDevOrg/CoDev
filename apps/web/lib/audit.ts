import "server-only";

import { and, desc, eq, lt, sql } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "./database";

export async function appendWorkspaceEvent(input: {
  workspaceId: string;
  actorId?: string | null;
  type: string;
  payload?: Record<string, unknown>;
}) {
  return getDatabase().transaction(async (transaction) => {
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

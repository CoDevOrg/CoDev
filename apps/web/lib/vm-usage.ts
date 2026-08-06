import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "./database";

export const VM_MINUTE_LIFETIME_QUOTA = 2_000;

function minutesBetween(startedAt: Date, endedAt: Date) {
  const ms = Math.max(0, endedAt.getTime() - startedAt.getTime());
  return Math.max(1, Math.ceil(ms / 60_000));
}

export async function getVmMinutesUsed(userId: string) {
  const db = getDatabase();
  const [usage] = await db
    .select({ minutesUsed: schema.userComputeUsage.minutesUsed })
    .from(schema.userComputeUsage)
    .where(eq(schema.userComputeUsage.userId, userId))
    .limit(1);

  const open = await db
    .select({ startedAt: schema.sandboxRuntimeIntervals.startedAt })
    .from(schema.sandboxRuntimeIntervals)
    .where(
      and(
        eq(schema.sandboxRuntimeIntervals.userId, userId),
        isNull(schema.sandboxRuntimeIntervals.endedAt),
      ),
    );

  const now = new Date();
  const openMinutes = open.reduce(
    (total, interval) => total + minutesBetween(interval.startedAt, now),
    0,
  );
  return (usage?.minutesUsed ?? 0) + openMinutes;
}

export async function getVmMinutesRemaining(userId: string) {
  return Math.max(
    0,
    VM_MINUTE_LIFETIME_QUOTA - (await getVmMinutesUsed(userId)),
  );
}

export async function openSandboxInterval(
  ownerId: string,
  workspaceId: string,
  source = "provision",
) {
  const db = getDatabase();
  const now = new Date();

  // Close any stale open interval for this workspace before opening a new one.
  await closeSandboxInterval(workspaceId, "reconcile");

  await db.insert(schema.sandboxRuntimeIntervals).values({
    userId: ownerId,
    workspaceId,
    startedAt: now,
    endedAt: null,
    source,
    createdAt: now,
    updatedAt: now,
  });
}

export async function closeSandboxInterval(
  workspaceId: string,
  source: "hibernate" | "stop" | "reconcile" | "failed",
) {
  const db = getDatabase();
  const now = new Date();

  await db.transaction(async (transaction) => {
    const open = await transaction
      .select({
        id: schema.sandboxRuntimeIntervals.id,
        userId: schema.sandboxRuntimeIntervals.userId,
        startedAt: schema.sandboxRuntimeIntervals.startedAt,
      })
      .from(schema.sandboxRuntimeIntervals)
      .where(
        and(
          eq(schema.sandboxRuntimeIntervals.workspaceId, workspaceId),
          isNull(schema.sandboxRuntimeIntervals.endedAt),
        ),
      )
      .for("update");

    for (const interval of open) {
      const minutes = minutesBetween(interval.startedAt, now);
      await transaction
        .update(schema.sandboxRuntimeIntervals)
        .set({
          endedAt: now,
          source,
          updatedAt: now,
        })
        .where(eq(schema.sandboxRuntimeIntervals.id, interval.id));

      await transaction
        .insert(schema.userComputeUsage)
        .values({
          userId: interval.userId,
          minutesUsed: minutes,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.userComputeUsage.userId,
          set: {
            minutesUsed: sql`${schema.userComputeUsage.minutesUsed} + ${minutes}`,
            updatedAt: now,
          },
        });
    }
  });
}

export async function closeOrphanSandboxIntervals() {
  const db = getDatabase();
  const orphans = await db
    .select({
      workspaceId: schema.sandboxRuntimeIntervals.workspaceId,
    })
    .from(schema.sandboxRuntimeIntervals)
    .innerJoin(
      schema.workspaces,
      eq(schema.workspaces.id, schema.sandboxRuntimeIntervals.workspaceId),
    )
    .where(
      and(
        isNull(schema.sandboxRuntimeIntervals.endedAt),
        sql`${schema.workspaces.status} not in ('ready', 'provisioning', 'stopping')`,
      ),
    );

  const unique = [...new Set(orphans.map((row) => row.workspaceId))];
  for (const workspaceId of unique) {
    await closeSandboxInterval(workspaceId, "reconcile");
  }
  return unique.length;
}

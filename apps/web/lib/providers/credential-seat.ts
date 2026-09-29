import "server-only";

import { and, eq, lt, sql } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import type { ExecutorSurface } from "./registry";

/**
 * One seat per credential, held by a live run.
 *
 * A subscription is a human seat: the provider runs one turn at a time on it.
 * The previous mechanism was a `unavailable_until` stamp set sixteen minutes
 * ahead of the claim, with no reaper — so a turn that died without releasing
 * locked the member out of every other surface for a quarter of an hour, and
 * the stamp itself was the only thing that ever freed it. Worse, the same
 * lock meant different things to different callers: chat rooms refused
 * outright on a busy seat, while Gen 2 claimed it, swallowed the busy error
 * and ran anyway.
 *
 * Here the seat is a row owned by a run and refreshed while that run is
 * polled. A run that stops polling releases it within `SEAT_STALE_AFTER_MS`,
 * and every executor gets the same answer to "is this credential busy".
 */

/**
 * How long a seat survives without a heartbeat.
 *
 * Every holder polls on a cadence well inside this: the room reply workflow
 * and both Gen 2 turn loops poll with a 25s server-side wait, and each poll
 * refreshes the seat. Two minutes is several missed polls, not a guess at how
 * long a turn might take — the seat is released when the run stops, not when
 * a timer expires, so this only has to cover a crashed holder.
 */
export const SEAT_STALE_AFTER_MS = 2 * 60_000;

export type SeatHolder = {
  surface: ExecutorSurface;
  ref: string;
  userId: string;
  heartbeatAt: Date;
};

export type SeatClaim =
  | { held: true }
  /** Someone else's run has it; `holder` is what to tell the member. */
  | { held: false; holder: SeatHolder | null };

function staleBefore() {
  return new Date(Date.now() - SEAT_STALE_AFTER_MS);
}

/**
 * Take the seat for a run, or report who holds it.
 *
 * Re-claiming with the same `ref` succeeds: a retried start must reattach to
 * its own run rather than deadlock against itself.
 */
export async function claimCredentialSeat(input: {
  credentialId: string;
  userId: string;
  surface: ExecutorSurface;
  ref: string;
}): Promise<SeatClaim> {
  const now = new Date();
  const [claimed] = await getDatabase()
    .insert(schema.providerCredentialRuns)
    .values({
      credentialId: input.credentialId,
      userId: input.userId,
      surface: input.surface,
      ref: input.ref,
      heartbeatAt: now,
    })
    .onConflictDoUpdate({
      target: schema.providerCredentialRuns.credentialId,
      set: {
        userId: input.userId,
        surface: input.surface,
        ref: input.ref,
        heartbeatAt: now,
        updatedAt: now,
      },
      // Take it over only from our own run or from one that stopped
      // heartbeating. Anything else keeps its seat.
      setWhere: sql`${schema.providerCredentialRuns.ref} = ${input.ref} or ${schema.providerCredentialRuns.heartbeatAt} < ${staleBefore()}`,
    })
    .returning({ id: schema.providerCredentialRuns.id });
  if (claimed) return { held: true };
  return {
    held: false,
    holder: await credentialSeatHolder(input.credentialId),
  };
}

/** Who holds this credential's seat, if anyone still does. */
export async function credentialSeatHolder(
  credentialId: string,
): Promise<SeatHolder | null> {
  const [row] = await getDatabase()
    .select()
    .from(schema.providerCredentialRuns)
    .where(eq(schema.providerCredentialRuns.credentialId, credentialId))
    .limit(1);
  if (!row) return null;
  if (row.heartbeatAt < staleBefore()) return null;
  return {
    surface: row.surface as ExecutorSurface,
    ref: row.ref,
    userId: row.userId,
    heartbeatAt: row.heartbeatAt,
  };
}

/**
 * Keep the seat while a run is alive. Called from the poll loops, so a long
 * turn holds its seat for exactly as long as it is actually running.
 */
export async function heartbeatCredentialSeat(input: {
  credentialId: string;
  ref: string;
}): Promise<void> {
  const now = new Date();
  await getDatabase()
    .update(schema.providerCredentialRuns)
    .set({ heartbeatAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.providerCredentialRuns.credentialId, input.credentialId),
        eq(schema.providerCredentialRuns.ref, input.ref),
      ),
    );
}

/**
 * Re-key a seat once its run has a durable id.
 *
 * A turn has to hold the seat *before* it starts — that is the point — but
 * only learns its session id from the start call. The claim therefore uses
 * the idempotency key and is re-tagged here, so the poll and cleanup paths,
 * which know only the session id, can release exactly their own seat.
 */
export async function retagCredentialSeat(input: {
  credentialId: string;
  fromRef: string;
  toRef: string;
}): Promise<void> {
  const now = new Date();
  await getDatabase()
    .update(schema.providerCredentialRuns)
    .set({ ref: input.toRef, heartbeatAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.providerCredentialRuns.credentialId, input.credentialId),
        eq(schema.providerCredentialRuns.ref, input.fromRef),
      ),
    );
}

/**
 * Give the seat back. Scoped by `ref` so a late finalizer from an earlier run
 * cannot release the seat a newer one has taken.
 */
export async function releaseCredentialSeat(input: {
  credentialId: string;
  ref: string;
}): Promise<void> {
  await getDatabase()
    .delete(schema.providerCredentialRuns)
    .where(
      and(
        eq(schema.providerCredentialRuns.credentialId, input.credentialId),
        eq(schema.providerCredentialRuns.ref, input.ref),
      ),
    );
}

/** Clear seats whose holder stopped heartbeating. Claiming already takes a
 *  stale seat over; this is for periodic tidying. */
export async function releaseStaleCredentialSeats(): Promise<number> {
  const deleted = await getDatabase()
    .delete(schema.providerCredentialRuns)
    .where(lt(schema.providerCredentialRuns.heartbeatAt, staleBefore()))
    .returning({ id: schema.providerCredentialRuns.id });
  return deleted.length;
}

const SURFACE_LABEL: Record<ExecutorSurface, string> = {
  rooms: "a chat room reply",
  workspace: "a workspace turn",
  gen2: "a workspace turn",
};

/** What to tell a member whose turn is waiting for their own seat. */
export function describeSeatHolder(holder: SeatHolder | null): string {
  if (!holder) return "Another turn is using this connection.";
  return `${SURFACE_LABEL[holder.surface]} is still using this connection.`;
}

/**
 * Wait for the seat instead of refusing the turn.
 *
 * A member's second turn is a queueing problem, not an error: the first one
 * finishes in seconds to minutes and the seat frees. Callers bound the wait
 * and surface `held: false` to the UI only when it runs out.
 */
export async function waitForCredentialSeat(
  input: {
    credentialId: string;
    userId: string;
    surface: ExecutorSurface;
    ref: string;
  },
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<SeatClaim> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const claim = await claimCredentialSeat(input);
    if (claim.held || Date.now() >= deadline) return claim;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An in-memory stand-in for the one-row-per-credential table, faithful to the
 * two things the real claim relies on: the unique index on `credential_id`,
 * and the conditional upsert that only takes a seat over from the same run or
 * one that stopped heartbeating.
 */
const rows = new Map<
  string,
  {
    credentialId: string;
    userId: string;
    surface: string;
    ref: string;
    heartbeatAt: Date;
  }
>();

const mocks = vi.hoisted(() => ({ insert: vi.fn(), now: () => new Date() }));

vi.mock("@codev/db", () => ({
  schema: { providerCredentialRuns: { credentialId: "credential_id" } },
}));

vi.mock("../platform/database", () => ({ getDatabase: () => database }));

vi.mock("drizzle-orm", () => ({
  and: (...parts: unknown[]) => parts,
  eq: (_column: unknown, value: unknown) => value,
  lt: (_column: unknown, value: unknown) => value,
  sql: Object.assign(() => "sql", { raw: () => "sql" }),
}));

type Captured = {
  values?: Record<string, unknown>;
  set?: Record<string, unknown>;
  where?: unknown[];
};

let captured: Captured = {};

const database = {
  insert: () => ({
    values: (values: Record<string, unknown>) => {
      captured.values = values;
      return {
        onConflictDoUpdate: () => ({
          returning: async () => {
            const credentialId = values.credentialId as string;
            const existing = rows.get(credentialId);
            const stale =
              existing &&
              existing.heartbeatAt.getTime() < Date.now() - 2 * 60_000;
            if (existing && existing.ref !== values.ref && !stale) return [];
            rows.set(credentialId, {
              credentialId,
              userId: values.userId as string,
              surface: values.surface as string,
              ref: values.ref as string,
              heartbeatAt: values.heartbeatAt as Date,
            });
            return [{ id: "seat-1" }];
          },
        }),
      };
    },
  }),
  select: () => ({
    from: () => ({
      where: (value: unknown) => ({
        limit: async () => {
          const row = rows.get(value as string);
          return row ? [row] : [];
        },
      }),
    }),
  }),
  update: () => ({
    set: (set: Record<string, unknown>) => ({
      where: async (where: unknown[]) => {
        const [credentialId, ref] = where as [string, string];
        const row = rows.get(credentialId);
        if (row && row.ref === ref) {
          rows.set(credentialId, {
            ...row,
            ...(set.ref ? { ref: set.ref as string } : {}),
            heartbeatAt: set.heartbeatAt as Date,
          });
        }
      },
    }),
  }),
  delete: () => ({
    where: (where: unknown[]) => {
      const [credentialId, ref] = where as [string, string];
      const row = rows.get(credentialId);
      if (row && row.ref === ref) rows.delete(credentialId);
      return { returning: async () => [] };
    },
  }),
};

const {
  claimCredentialSeat,
  credentialSeatHolder,
  describeSeatHolder,
  heartbeatCredentialSeat,
  releaseCredentialSeat,
  retagCredentialSeat,
} = await import("./credential-seat");

const seat = {
  credentialId: "11111111-1111-4111-8111-111111111111",
  userId: "user-1",
  surface: "gen2" as const,
};

describe("credential seat", () => {
  beforeEach(() => {
    rows.clear();
    captured = {};
    mocks.insert.mockReset();
    vi.useRealTimers();
  });

  it("gives one run the seat and tells the next who holds it", async () => {
    expect(await claimCredentialSeat({ ...seat, ref: "run-1" })).toEqual({
      held: true,
    });

    const second = await claimCredentialSeat({
      ...seat,
      surface: "rooms",
      ref: "run-2",
    });
    expect(second.held).toBe(false);
    // The member is told what is using their subscription rather than being
    // handed a bare failure — this is the message the queueing UX shows.
    expect(second.held === false && second.holder?.ref).toBe("run-1");
    expect(
      describeSeatHolder(second.held === false ? second.holder : null),
    ).toBe("a workspace turn is still using this connection.");
  });

  it("lets the same run re-claim its own seat", async () => {
    await claimCredentialSeat({ ...seat, ref: "run-1" });
    // A retried start must reattach rather than deadlock against itself.
    expect(await claimCredentialSeat({ ...seat, ref: "run-1" })).toEqual({
      held: true,
    });
  });

  it("frees a seat whose holder stopped heartbeating", async () => {
    vi.useFakeTimers();
    await claimCredentialSeat({ ...seat, ref: "dead-run" });

    // The old mechanism stamped the credential unavailable for sixteen
    // minutes with no reaper, so a crashed turn blocked every other surface
    // for a quarter of an hour. Here the seat is gone two minutes after the
    // holder stops polling.
    vi.advanceTimersByTime(2 * 60_000 + 1_000);
    expect(await credentialSeatHolder(seat.credentialId)).toBeNull();
    expect(await claimCredentialSeat({ ...seat, ref: "new-run" })).toEqual({
      held: true,
    });
  });

  it("keeps the seat while the run is still being polled", async () => {
    vi.useFakeTimers();
    await claimCredentialSeat({ ...seat, ref: "run-1" });

    for (let poll = 0; poll < 10; poll += 1) {
      vi.advanceTimersByTime(30_000);
      await heartbeatCredentialSeat({
        credentialId: seat.credentialId,
        ref: "run-1",
      });
    }

    // Five minutes in and still held: a long turn is not a stale one.
    const blocked = await claimCredentialSeat({ ...seat, ref: "run-2" });
    expect(blocked.held).toBe(false);
  });

  it("ignores a release from a run that no longer holds the seat", async () => {
    await claimCredentialSeat({ ...seat, ref: "run-1" });
    // A late finalizer from an earlier turn must not free the seat a newer
    // turn is using.
    await releaseCredentialSeat({
      credentialId: seat.credentialId,
      ref: "an-older-run",
    });
    expect(await credentialSeatHolder(seat.credentialId)).toMatchObject({
      ref: "run-1",
    });
  });

  it("re-keys a seat onto the run id once the run has one", async () => {
    await claimCredentialSeat({ ...seat, ref: "idempotency-key" });
    await retagCredentialSeat({
      credentialId: seat.credentialId,
      fromRef: "idempotency-key",
      toRef: "session-9",
    });
    expect(await credentialSeatHolder(seat.credentialId)).toMatchObject({
      ref: "session-9",
    });
    await releaseCredentialSeat({
      credentialId: seat.credentialId,
      ref: "session-9",
    });
    expect(await credentialSeatHolder(seat.credentialId)).toBeNull();
  });
});

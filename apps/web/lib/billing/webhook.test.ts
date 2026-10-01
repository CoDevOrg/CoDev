import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  seen: false,
  inserted: [] as unknown[],
  retrieve: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (mocks.seen ? [{ id: "evt" }] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (value: unknown) => ({
        onConflictDoNothing: async () => {
          mocks.inserted.push(value);
        },
      }),
    }),
  }),
}));
vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));
vi.mock("./stripe", () => ({
  getStripe: () => ({ subscriptions: { retrieve: mocks.retrieve } }),
}));
vi.mock("./subscriptions", async () => {
  const actual =
    await vi.importActual<typeof import("./subscriptions")>("./subscriptions");
  return { ...actual, syncStripeSubscription: mocks.sync };
});

import { handleStripeEvent, subscriptionIdForEvent } from "./webhook";

const event = (type: string, object: unknown, id = "evt_1") =>
  ({ id, type, data: { object } }) as unknown as Stripe.Event;

describe("subscriptionIdForEvent", () => {
  it("finds the subscription for each handled event type", () => {
    expect(
      subscriptionIdForEvent(
        event("customer.subscription.updated", { id: "sub_1" }),
      ),
    ).toBe("sub_1");
    expect(
      subscriptionIdForEvent(
        event("checkout.session.completed", {
          mode: "subscription",
          subscription: "sub_2",
        }),
      ),
    ).toBe("sub_2");
    expect(
      subscriptionIdForEvent(
        event("checkout.session.completed", {
          mode: "payment",
          subscription: null,
        }),
      ),
    ).toBeNull();
    expect(
      subscriptionIdForEvent(
        event("invoice.paid", {
          parent: { subscription_details: { subscription: "sub_3" } },
        }),
      ),
    ).toBe("sub_3");
    expect(
      subscriptionIdForEvent(
        event("invoice.payment_failed", { subscription: "sub_4" }),
      ),
    ).toBe("sub_4");
    expect(subscriptionIdForEvent(event("customer.created", {}))).toBeNull();
  });
});

describe("handleStripeEvent", () => {
  beforeEach(() => {
    mocks.seen = false;
    mocks.inserted.length = 0;
    mocks.retrieve.mockReset().mockResolvedValue({ id: "sub_1" });
    mocks.sync.mockReset().mockResolvedValue({ synced: true });
  });

  it("re-reads the subscription from Stripe, syncs it, and records the event", async () => {
    const outcome = await handleStripeEvent(
      event("customer.subscription.updated", {
        id: "sub_1",
        status: "canceled",
      }),
    );
    expect(mocks.retrieve).toHaveBeenCalledWith("sub_1");
    expect(mocks.sync).toHaveBeenCalledWith({ id: "sub_1" });
    expect(outcome).toEqual({ handled: true });
    expect(mocks.inserted).toEqual([
      { id: "evt_1", type: "customer.subscription.updated" },
    ]);
  });

  it("skips a redelivered event", async () => {
    mocks.seen = true;
    expect(
      await handleStripeEvent(
        event("customer.subscription.updated", { id: "sub_1" }),
      ),
    ).toEqual({ handled: false, reason: "duplicate" });
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("acknowledges unrelated events without calling Stripe", async () => {
    expect(await handleStripeEvent(event("customer.created", {}))).toEqual({
      handled: false,
      reason: "ignored_event",
    });
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("does not record the event when processing fails, so Stripe retries", async () => {
    mocks.retrieve.mockRejectedValue(new Error("stripe down"));
    await expect(
      handleStripeEvent(
        event("customer.subscription.updated", { id: "sub_1" }),
      ),
    ).rejects.toThrow("stripe down");
    expect(mocks.inserted).toHaveLength(0);
  });
});

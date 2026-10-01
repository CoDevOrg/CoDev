import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  selects: [] as unknown[][],
  written: [] as Record<string, unknown>[],
}));

vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.selects.shift() ?? [],
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async ({
          set,
        }: {
          set: Record<string, unknown>;
        }) => {
          mocks.written.push({ ...values, ...set });
        },
      }),
    }),
  }),
}));
vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));

import {
  mapStripeStatus,
  subscriptionPeriodEnd,
  syncStripeSubscription,
} from "./subscriptions";

function subscription(
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Subscription {
  return {
    id: "sub_new",
    status: "active",
    customer: "cus_1",
    metadata: { userId: "user-1" },
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    items: { data: [{ current_period_end: 1_800_000_000 }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe("mapStripeStatus", () => {
  it("maps Stripe states onto the table's four", () => {
    expect(mapStripeStatus("active")).toBe("active");
    expect(mapStripeStatus("trialing")).toBe("trialing");
    expect(mapStripeStatus("past_due")).toBe("past_due");
    expect(mapStripeStatus("unpaid")).toBe("past_due");
    expect(mapStripeStatus("paused")).toBe("past_due");
    expect(mapStripeStatus("canceled")).toBe("canceled");
    expect(mapStripeStatus("incomplete_expired")).toBe("canceled");
    expect(mapStripeStatus("incomplete")).toBeNull();
  });
});

describe("subscriptionPeriodEnd", () => {
  it("uses the latest item period end", () => {
    const sub = subscription({
      items: {
        data: [{ current_period_end: 10 }, { current_period_end: 20 }],
      },
    } as unknown as Partial<Stripe.Subscription>);
    expect(subscriptionPeriodEnd(sub)?.getTime()).toBe(20_000);
  });
});

describe("syncStripeSubscription", () => {
  beforeEach(() => {
    mocks.selects.length = 0;
    mocks.written.length = 0;
  });

  it("writes an active subscription for the member named in metadata", async () => {
    // customer lookup misses, user lookup hits, no existing row
    mocks.selects.push([], [{ id: "user-1" }], []);
    const result = await syncStripeSubscription(subscription());
    expect(result).toEqual({
      synced: true,
      organizationId: "user-1",
      status: "active",
    });
    expect(mocks.written[0]).toMatchObject({
      planId: "pro",
      status: "active",
      provider: "stripe",
      providerCustomerId: "cus_1",
      providerSubscriptionId: "sub_new",
      cancelAtPeriodEnd: false,
    });
  });

  it("returns a canceled member to Free and keeps the customer", async () => {
    mocks.selects.push(
      [{ organizationId: "user-1" }],
      [
        {
          providerSubscriptionId: "sub_new",
          provider: "stripe",
          status: "active",
        },
      ],
    );
    await syncStripeSubscription(subscription({ status: "canceled" }));
    expect(mocks.written[0]).toMatchObject({
      planId: "free",
      status: "canceled",
      providerCustomerId: "cus_1",
    });
  });

  it("flags a subscription that cancels at period end", async () => {
    mocks.selects.push([{ organizationId: "user-1" }], []);
    await syncStripeSubscription(subscription({ cancel_at_period_end: true }));
    expect(mocks.written[0]).toMatchObject({
      status: "active",
      cancelAtPeriodEnd: true,
    });
  });

  it("ignores a late cancel of an old subscription when a newer one is live", async () => {
    mocks.selects.push(
      [{ organizationId: "user-1" }],
      [
        {
          providerSubscriptionId: "sub_current",
          provider: "stripe",
          status: "active",
        },
      ],
    );
    const result = await syncStripeSubscription(
      subscription({ id: "sub_old", status: "canceled" }),
    );
    expect(result).toEqual({
      synced: false,
      reason: "superseded_subscription",
    });
    expect(mocks.written).toHaveLength(0);
  });

  it("does nothing for an incomplete subscription or an unknown member", async () => {
    expect(
      await syncStripeSubscription(subscription({ status: "incomplete" })),
    ).toEqual({ synced: false, reason: "subscription_incomplete" });
    mocks.selects.push([], []);
    expect(await syncStripeSubscription(subscription())).toEqual({
      synced: false,
      reason: "no_matching_member",
    });
    expect(mocks.written).toHaveLength(0);
  });
});

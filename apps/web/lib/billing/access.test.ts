import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  isAdmin: false,
}));

vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (mocks.row ? [mocks.row] : []),
        }),
      }),
    }),
  }),
}));
vi.mock("../admin/admin", () => ({
  isUserAdmin: async () => mocks.isAdmin,
}));

import {
  BillingRequiredError,
  getBillingStatus,
  requireIndividualPlan,
  resolveBillingAccess,
} from "./access";

const now = new Date("2026-10-01T00:00:00Z");
const day = 24 * 60 * 60 * 1000;
const stripeRow = {
  planId: "pro" as const,
  status: "active" as const,
  provider: "stripe",
  currentPeriodEnd: new Date(now.getTime() + 10 * day),
};

describe("resolveBillingAccess", () => {
  it("lets application admins through without a subscription", () => {
    expect(resolveBillingAccess({ isAdmin: true, row: null, now })).toEqual({
      hasAccess: true,
      source: "admin",
    });
  });

  it("reports a paying administrator as a subscriber", () => {
    expect(
      resolveBillingAccess({ isAdmin: true, row: stripeRow, now }).source,
    ).toBe("subscription");
  });

  it("denies a member with no row or the free plan", () => {
    expect(
      resolveBillingAccess({ isAdmin: false, row: null, now }).hasAccess,
    ).toBe(false);
    expect(
      resolveBillingAccess({
        isAdmin: false,
        row: { ...stripeRow, planId: "free" },
        now,
      }).hasAccess,
    ).toBe(false);
  });

  it("grants active and trialing Individual subscriptions", () => {
    for (const status of ["active", "trialing"] as const) {
      expect(
        resolveBillingAccess({
          isAdmin: false,
          row: { ...stripeRow, status },
          now,
        }),
      ).toEqual({ hasAccess: true, source: "subscription" });
    }
  });

  it("blocks past_due and canceled", () => {
    for (const status of ["past_due", "canceled"] as const) {
      expect(
        resolveBillingAccess({
          isAdmin: false,
          row: { ...stripeRow, status },
          now,
        }).hasAccess,
      ).toBe(false);
    }
  });

  it("cuts off a Stripe row whose period ended more than the grace ago", () => {
    const lapsed = {
      ...stripeRow,
      currentPeriodEnd: new Date(now.getTime() - 4 * day),
    };
    expect(
      resolveBillingAccess({ isAdmin: false, row: lapsed, now }).hasAccess,
    ).toBe(false);
    const recent = {
      ...stripeRow,
      currentPeriodEnd: new Date(now.getTime() - 1 * day),
    };
    expect(
      resolveBillingAccess({ isAdmin: false, row: recent, now }).hasAccess,
    ).toBe(true);
  });

  it("treats a provider-less pro row as an admin grant with no period limit", () => {
    expect(
      resolveBillingAccess({
        isAdmin: false,
        row: {
          planId: "pro",
          status: "active",
          provider: null,
          currentPeriodEnd: null,
        },
        now,
      }),
    ).toEqual({ hasAccess: true, source: "admin_grant" });
  });
});

describe("requireIndividualPlan", () => {
  beforeEach(() => {
    mocks.row = null;
    mocks.isAdmin = false;
  });

  it("throws a 402 subscription_required for an unpaid owner", async () => {
    mocks.row = { ...stripeRow, planId: "free" };
    const error = await requireIndividualPlan("owner").catch((e) => e);
    expect(error).toBeInstanceOf(BillingRequiredError);
    const response = error.toResponse() as Response;
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      code: "subscription_required",
    });
  });

  it("passes for a paid owner and for an admin", async () => {
    mocks.row = stripeRow;
    await expect(requireIndividualPlan("owner")).resolves.toBeUndefined();
    mocks.row = null;
    mocks.isAdmin = true;
    await expect(requireIndividualPlan("owner")).resolves.toBeUndefined();
  });
});

describe("getBillingStatus", () => {
  beforeEach(() => {
    mocks.row = null;
    mocks.isAdmin = false;
  });

  it("reports Free for a member who never subscribed", async () => {
    mocks.row = {
      planId: "free",
      status: "active",
      provider: null,
      providerCustomerId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
    expect(await getBillingStatus("u")).toMatchObject({
      planName: "Free",
      status: null,
      hasAccess: false,
      hasStripeCustomer: false,
      priceUsdPerMonth: 0,
    });
  });

  it("reports an Individual subscription that ends at period end", async () => {
    mocks.row = {
      ...stripeRow,
      providerCustomerId: "cus_1",
      cancelAtPeriodEnd: true,
    };
    expect(await getBillingStatus("u")).toMatchObject({
      planName: "Individual",
      status: "active",
      hasAccess: true,
      accessSource: "subscription",
      cancelAtPeriodEnd: true,
      hasStripeCustomer: true,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selects: [] as unknown[][],
  upserts: [] as Array<{ values: unknown; update: unknown }>,
}));

vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => mocks.selects.shift() ?? [] }),
      }),
    }),
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: async ({ set }: { set: unknown }) => {
          mocks.upserts.push({ values, update: set });
        },
      }),
    }),
  }),
}));

import { assignOrganizationPlan } from "./admin-feature-access";

const input = { organizationId: "org-1", planId: "pro" as const };

describe("assignOrganizationPlan", () => {
  beforeEach(() => {
    mocks.selects.length = 0;
    mocks.upserts.length = 0;
  });

  it("comps a plan when no Stripe subscription is live", async () => {
    mocks.selects.push(
      [{ id: "org-1" }],
      [{ id: "pro" }],
      [{ provider: null, status: "active" }],
    );
    await assignOrganizationPlan(input);
    expect(mocks.upserts).toHaveLength(1);
    expect(mocks.upserts[0]?.update).toMatchObject({
      planId: "pro",
      status: "active",
      provider: null,
      currentPeriodEnd: null,
      canceledAt: null,
      cancelAtPeriodEnd: false,
    });
  });

  it("detaches a canceled Stripe subscription when replacing it with a manual plan", async () => {
    mocks.selects.push(
      [{ id: "org-1" }],
      [{ id: "pro" }],
      [
        {
          provider: "stripe",
          status: "canceled",
          providerSubscriptionId: "sub_old",
        },
      ],
    );
    await assignOrganizationPlan(input);
    expect(mocks.upserts[0]?.update).toMatchObject({
      provider: null,
      providerSubscriptionId: "sub_old",
      currentPeriodEnd: null,
      canceledAt: null,
      cancelAtPeriodEnd: false,
    });
  });

  it("refuses to overwrite a live Stripe subscription", async () => {
    mocks.selects.push(
      [{ id: "org-1" }],
      [{ id: "pro" }],
      [{ provider: "stripe", status: "active" }],
    );
    await expect(assignOrganizationPlan(input)).rejects.toThrow(
      /live Stripe subscription/,
    );
    expect(mocks.upserts).toHaveLength(0);
  });

  it("allows replacing a canceled Stripe subscription", async () => {
    mocks.selects.push(
      [{ id: "org-1" }],
      [{ id: "pro" }],
      [{ provider: "stripe", status: "canceled" }],
    );
    await assignOrganizationPlan(input);
    expect(mocks.upserts).toHaveLength(1);
  });
});

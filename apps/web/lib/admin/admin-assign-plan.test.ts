import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selects: [] as unknown[][],
  upserts: [] as unknown[],
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
        onConflictDoUpdate: async () => {
          mocks.upserts.push(values);
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComputeDatabase } from "../gen2/compute-database";
import { getWorkspaceOwnerEntitlement } from "./workspace-entitlement";

vi.mock("../platform/database", () => ({ getDatabase: vi.fn() }));

function database(subscription: Record<string, unknown> | null = null) {
  const rows = [
    [{ isAdmin: false }],
    subscription ? [subscription] : [],
    [{ count: 1 }],
  ];
  return {
    select: () => {
      const result = rows.shift();
      const query = {
        from: () => query,
        where: () => query,
        limit: async () => result,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return query;
    },
  } as unknown as ComputeDatabase;
}

beforeEach(() => {
  vi.stubEnv("GEN2_FREE_ARM_ENABLED", "true");
  vi.stubEnv("GEN2_FREE_ARM_OWNER_IDS", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Free and Individual workspace entitlements", () => {
  it("gives Free five lifetime hours, one saved workspace and one active workspace", async () => {
    expect(
      await getWorkspaceOwnerEntitlement("owner", database()),
    ).toMatchObject({
      tier: "free",
      enabled: true,
      usageWindow: "lifetime",
      monthlyLimitMs: 5 * 3_600_000,
      workspaceLimit: 1,
      activeWorkspaceLimit: 1,
      unlimited: false,
      ownedWorkspaceCount: 1,
    });
  });
  it.each(["active", "trialing"])(
    "gives %s Individual forty monthly hours with the same workspace limits",
    async (status) => {
      expect(
        await getWorkspaceOwnerEntitlement(
          "owner",
          database({
            planId: "pro",
            status,
            provider: null,
            currentPeriodEnd: null,
          }),
        ),
      ).toMatchObject({
        tier: "paid",
        enabled: true,
        usageWindow: "month",
        monthlyLimitMs: 40 * 3_600_000,
        workspaceLimit: 1,
        activeWorkspaceLimit: 1,
      });
    },
  );
  it.each(["past_due", "canceled"])(
    "does not grant Individual hours to a %s subscription",
    async (status) => {
      expect(
        await getWorkspaceOwnerEntitlement(
          "owner",
          database({
            planId: "pro",
            status,
            provider: "stripe",
            currentPeriodEnd: new Date("2099-01-01"),
          }),
        ),
      ).toMatchObject({
        tier: "free",
        usageWindow: "lifetime",
        monthlyLimitMs: 5 * 3_600_000,
      });
    },
  );
  it("keeps paid access available independently of the Free rollout switch", async () => {
    vi.stubEnv("GEN2_FREE_ARM_ENABLED", "false");
    expect(
      await getWorkspaceOwnerEntitlement(
        "owner",
        database({
          planId: "pro",
          status: "active",
          provider: null,
        }),
      ),
    ).toMatchObject({ tier: "paid", enabled: true });
    expect(
      await getWorkspaceOwnerEntitlement("owner", database()),
    ).toMatchObject({ tier: "free", enabled: false });
  });
});

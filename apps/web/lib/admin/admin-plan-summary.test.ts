import { describe, expect, it } from "vitest";
import type { AdminAccountAccessData } from "./admin-account-access";
import { buildAdminPlanSummary } from "./admin-plan-summary";

const now = new Date("2026-10-07T12:00:00Z");
function account(
  overrides: Partial<AdminAccountAccessData[number]> = {},
): AdminAccountAccessData[number] {
  return {
    id: "user",
    login: "user",
    name: null,
    email: null,
    isAdmin: false,
    planId: "free",
    subscriptionStatus: "canceled",
    provider: null,
    currentPeriodEnd: null,
    ...overrides,
  };
}

describe("admin plan reporting", () => {
  it("separates subscribers, trials and grants and falls back to Free for expired access", () => {
    const rows = buildAdminPlanSummary(
      [
        account(),
        account({
          planId: "pro",
          provider: "stripe",
          subscriptionStatus: "active",
          currentPeriodEnd: new Date("2026-11-01"),
        }),
        account({
          planId: "pro",
          provider: "stripe",
          subscriptionStatus: "trialing",
        }),
        account({ planId: "pro", subscriptionStatus: "active" }),
        account({
          planId: "pro",
          provider: "stripe",
          subscriptionStatus: "active",
          currentPeriodEnd: new Date("2026-09-01"),
        }),
        account({
          planId: "pro",
          provider: "stripe",
          subscriptionStatus: "past_due",
        }),
        account({ isAdmin: true }),
      ],
      now,
    );
    expect(rows.find((row) => row.id === "free")?.accounts).toBe(4);
    expect(rows.find((row) => row.id === "pro")).toMatchObject({
      accounts: 3,
      subscribers: 1,
      trials: 1,
      grants: 1,
    });
    expect(rows.find((row) => row.id === "power")?.accounts).toBe(0);
  });

  it("counts administrator plans alongside members without adding unlimited admin usage to estimates", () => {
    const rows = buildAdminPlanSummary(
      [
        account({ planId: "pro", subscriptionStatus: "active" }),
        ...Array.from({ length: 3 }, () =>
          account({
            isAdmin: true,
            planId: "pro",
            subscriptionStatus: "active",
          }),
        ),
        account({ isAdmin: true }),
        account(),
      ],
      now,
    );
    const individual = rows.find((row) => row.id === "pro")!;
    expect(individual.accounts).toBe(4);
    expect(individual.grants).toBe(4);
    expect(individual.totalCostUsd).toBe(individual.costPerAccountUsd);
    expect(rows.find((row) => row.id === "free")?.accounts).toBe(2);
    expect(rows.reduce((sum, row) => sum + row.accounts, 0)).toBe(6);
  });

  it("estimates Free lifetime hours and Individual monthly hours with persistent disk storage", () => {
    const rows = buildAdminPlanSummary(
      [account(), account({ planId: "pro", subscriptionStatus: "active" })],
      now,
    );
    expect(rows[0]?.computeHours).toBe(5);
    expect(rows[0]?.costPerAccountUsd).toBeCloseTo(0.951);
    const individual = rows.find((row) => row.id === "pro")!;
    expect(individual.computeHours).toBe(40);
    expect(individual.costPerAccountUsd).toBeCloseTo(3.408);
    expect(individual.totalCostUsd).toBe(individual.costPerAccountUsd);
    expect(
      rows.find((row) => row.id === "enterprise")?.costPerAccountUsd,
    ).toBeCloseTo(82.2);
  });
});

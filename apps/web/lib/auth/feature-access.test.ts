import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  evaluateFeatureAccess,
  FeatureAccessError,
  getAccessSnapshot,
  requireFeature,
  resolveFeatureEntitlement,
} from "./feature-access";

const mocks = vi.hoisted(() => ({
  rows: new Map<string, unknown[]>(),
}));

vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        const rows = mocks.rows.get(getTableName(table)) ?? [];
        return {
          where: () =>
            Object.assign(Promise.resolve(rows), {
              limit: async (count: number) => rows.slice(0, count),
            }),
        };
      },
    }),
  }),
}));

const baseFacts = {
  feature: "hosted_codex_subscription" as const,
  emergencyDisabled: false,
  userOverride: null,
  organizationOverride: null,
  planId: "team" as const,
  planEntitlement: null,
};

describe("feature entitlement resolution", () => {
  beforeEach(() => {
    mocks.rows.clear();
    vi.unstubAllEnvs();
  });

  it("gives the emergency disable highest precedence", () => {
    expect(
      resolveFeatureEntitlement({
        ...baseFacts,
        emergencyDisabled: true,
        userOverride: true,
        organizationOverride: true,
        planEntitlement: true,
      }),
    ).toEqual({
      feature: "hosted_codex_subscription",
      enabled: false,
      reason: "emergency_disabled",
    });
  });

  it("applies user, organization, plan, then default precedence", () => {
    expect(
      resolveFeatureEntitlement({
        ...baseFacts,
        userOverride: false,
        organizationOverride: true,
        planEntitlement: true,
      }).reason,
    ).toBe("user_override");
    expect(
      resolveFeatureEntitlement({
        ...baseFacts,
        organizationOverride: false,
        planEntitlement: true,
      }).reason,
    ).toBe("organization_override");
    expect(
      resolveFeatureEntitlement({ ...baseFacts, planEntitlement: false }),
    ).toEqual({
      feature: "hosted_codex_subscription",
      enabled: false,
      reason: "plan_entitlement",
      planId: "team",
    });
    expect(resolveFeatureEntitlement(baseFacts)).toEqual({
      feature: "hosted_codex_subscription",
      enabled: true,
      reason: "feature_default",
    });
  });

  it("exposes a stable forbidden error without changing authorization", () => {
    const decision = resolveFeatureEntitlement({
      ...baseFacts,
      organizationOverride: false,
    });
    const error = new FeatureAccessError(decision);

    expect(error).toMatchObject({
      name: "FeatureAccessError",
      status: 403,
      decision,
    });
  });

  it("loads one explainable access snapshot with user-first precedence", async () => {
    mocks.rows.set("user_feature_overrides", [
      { feature: "hosted_codex_subscription", enabled: false },
    ]);
    mocks.rows.set("organization_feature_overrides", [
      { feature: "hosted_codex_subscription", enabled: true },
    ]);
    mocks.rows.set("organization_subscriptions", [{ planId: "team" }]);
    mocks.rows.set("plan_entitlements", [
      { feature: "hosted_codex_subscription", enabled: true },
    ]);

    await expect(
      getAccessSnapshot({ organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual({
      planId: "team",
      features: {
        hosted_codex_subscription: {
          feature: "hosted_codex_subscription",
          enabled: false,
          reason: "user_override",
        },
      },
    });
  });

  it("falls back to the free plan and enforces emergency disables", async () => {
    mocks.rows.set("plan_entitlements", [
      { feature: "hosted_codex_subscription", enabled: true },
    ]);
    vi.stubEnv("HOSTED_CODEX_EMERGENCY_DISABLED", "true");

    await expect(
      evaluateFeatureAccess({
        organizationId: "org-1",
        feature: "hosted_codex_subscription",
      }),
    ).resolves.toEqual({
      feature: "hosted_codex_subscription",
      enabled: false,
      reason: "emergency_disabled",
    });
  });

  it("throws a forbidden error for unavailable features", async () => {
    mocks.rows.set("organization_feature_overrides", [
      { feature: "hosted_codex_subscription", enabled: false },
    ]);

    await expect(
      requireFeature({
        organizationId: "org-1",
        userId: "user-1",
        feature: "hosted_codex_subscription",
      }),
    ).rejects.toMatchObject({
      name: "FeatureAccessError",
      status: 403,
      decision: { reason: "organization_override" },
    });
  });
});

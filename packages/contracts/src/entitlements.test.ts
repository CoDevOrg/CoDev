import { describe, expect, it } from "vitest";

import {
  featureEntitlementDecisionSchema,
  featureKeySchema,
  organizationRoleSchema,
  planIdSchema,
} from "./entitlements";

describe("entitlement contracts", () => {
  it("defines organization roles separately from workspace access roles", () => {
    expect(organizationRoleSchema.options).toEqual([
      "owner",
      "admin",
      "billing_admin",
      "member",
    ]);
    expect(() => organizationRoleSchema.parse("co_steer")).toThrow();
  });

  it("defines stable plan and feature identifiers", () => {
    expect(planIdSchema.options).toEqual(["free", "pro", "team", "enterprise"]);
    expect(featureKeySchema.parse("hosted_codex_subscription")).toBe(
      "hosted_codex_subscription",
    );
    expect(() => featureKeySchema.parse("unknown_feature")).toThrow();
  });

  it("accepts explainable feature decisions", () => {
    expect(
      featureEntitlementDecisionSchema.parse({
        feature: "hosted_codex_subscription",
        enabled: true,
        reason: "plan_entitlement",
        planId: "team",
      }),
    ).toMatchObject({ enabled: true, planId: "team" });

    expect(
      featureEntitlementDecisionSchema.parse({
        feature: "hosted_codex_subscription",
        enabled: false,
        reason: "emergency_disabled",
      }).enabled,
    ).toBe(false);
  });

  it("rejects inconsistent or incomplete decisions", () => {
    expect(() =>
      featureEntitlementDecisionSchema.parse({
        feature: "hosted_codex_subscription",
        enabled: true,
        reason: "emergency_disabled",
      }),
    ).toThrow();
    expect(() =>
      featureEntitlementDecisionSchema.parse({
        feature: "hosted_codex_subscription",
        enabled: true,
        reason: "plan_entitlement",
      }),
    ).toThrow();
  });
});

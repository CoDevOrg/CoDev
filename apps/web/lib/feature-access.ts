import "server-only";

import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";

import {
  featureKeySchema,
  type FeatureEntitlementDecision,
  type FeatureKey,
  type PlanId,
} from "@codev/contracts";
import { schema } from "@codev/db";

import { getDatabase } from "./database";

export const FEATURE_DEFAULTS = {
  hosted_codex_subscription: true,
} as const satisfies Record<FeatureKey, boolean>;

const FEATURE_EMERGENCY_DISABLE_ENV = {
  hosted_codex_subscription: "HOSTED_CODEX_EMERGENCY_DISABLED",
} as const satisfies Record<FeatureKey, string>;

type FeatureAccessFacts = {
  feature: FeatureKey;
  emergencyDisabled: boolean;
  userOverride: boolean | null;
  organizationOverride: boolean | null;
  planId: PlanId;
  planEntitlement: boolean | null;
};

export type FeatureAccessInput = {
  organizationId: string;
  userId?: string;
  feature: FeatureKey;
  now?: Date;
};

export type FeatureAccessSnapshot = {
  planId: PlanId;
  features: Record<FeatureKey, FeatureEntitlementDecision>;
};

export class FeatureAccessError extends Error {
  readonly status = 403;

  constructor(readonly decision: FeatureEntitlementDecision) {
    super(`Feature ${decision.feature} is not available.`);
    this.name = "FeatureAccessError";
  }
}

/** Resolve precedence without I/O so every branch remains directly testable. */
export function resolveFeatureEntitlement(
  facts: FeatureAccessFacts,
): FeatureEntitlementDecision {
  if (facts.emergencyDisabled) {
    return {
      feature: facts.feature,
      enabled: false,
      reason: "emergency_disabled",
    };
  }
  if (facts.userOverride !== null) {
    return {
      feature: facts.feature,
      enabled: facts.userOverride,
      reason: "user_override",
    };
  }
  if (facts.organizationOverride !== null) {
    return {
      feature: facts.feature,
      enabled: facts.organizationOverride,
      reason: "organization_override",
    };
  }
  if (facts.planEntitlement !== null) {
    return {
      feature: facts.feature,
      enabled: facts.planEntitlement,
      reason: "plan_entitlement",
      planId: facts.planId,
    };
  }
  return {
    feature: facts.feature,
    enabled: FEATURE_DEFAULTS[facts.feature],
    reason: "feature_default",
  };
}

async function loadFeatureAccessFacts(
  input: Omit<FeatureAccessInput, "feature"> & { features: FeatureKey[] },
) {
  const db = getDatabase();
  const now = input.now ?? new Date();
  const userOverridesPromise = input.userId
    ? db
        .select({
          feature: schema.userFeatureOverrides.feature,
          enabled: schema.userFeatureOverrides.enabled,
        })
        .from(schema.userFeatureOverrides)
        .where(
          and(
            eq(
              schema.userFeatureOverrides.organizationId,
              input.organizationId,
            ),
            eq(schema.userFeatureOverrides.userId, input.userId),
            inArray(schema.userFeatureOverrides.feature, input.features),
            or(
              isNull(schema.userFeatureOverrides.expiresAt),
              gt(schema.userFeatureOverrides.expiresAt, now),
            ),
          ),
        )
    : Promise.resolve([]);

  const [userOverrides, organizationOverrides, subscriptions] =
    await Promise.all([
      userOverridesPromise,
      db
        .select({
          feature: schema.organizationFeatureOverrides.feature,
          enabled: schema.organizationFeatureOverrides.enabled,
        })
        .from(schema.organizationFeatureOverrides)
        .where(
          and(
            eq(
              schema.organizationFeatureOverrides.organizationId,
              input.organizationId,
            ),
            inArray(
              schema.organizationFeatureOverrides.feature,
              input.features,
            ),
            or(
              isNull(schema.organizationFeatureOverrides.expiresAt),
              gt(schema.organizationFeatureOverrides.expiresAt, now),
            ),
          ),
        ),
      db
        .select({ planId: schema.organizationSubscriptions.planId })
        .from(schema.organizationSubscriptions)
        .where(
          and(
            eq(
              schema.organizationSubscriptions.organizationId,
              input.organizationId,
            ),
            inArray(schema.organizationSubscriptions.status, [
              "trialing",
              "active",
            ]),
          ),
        )
        .limit(1),
    ]);

  const planId = subscriptions[0]?.planId ?? "free";
  const planEntitlements = await db
    .select({
      feature: schema.planEntitlements.feature,
      enabled: schema.planEntitlements.enabled,
    })
    .from(schema.planEntitlements)
    .where(
      and(
        eq(schema.planEntitlements.planId, planId),
        inArray(schema.planEntitlements.feature, input.features),
      ),
    );

  return {
    now,
    planId,
    userOverrides: new Map(
      userOverrides.map((row) => [row.feature, row.enabled] as const),
    ),
    organizationOverrides: new Map(
      organizationOverrides.map((row) => [row.feature, row.enabled] as const),
    ),
    planEntitlements: new Map(
      planEntitlements.map((row) => [row.feature, row.enabled] as const),
    ),
  };
}

function isEmergencyDisabled(
  feature: FeatureKey,
  env: NodeJS.ProcessEnv = process.env,
) {
  return env[FEATURE_EMERGENCY_DISABLE_ENV[feature]] === "true";
}

export async function getAccessSnapshot(
  input: Omit<FeatureAccessInput, "feature">,
): Promise<FeatureAccessSnapshot> {
  const features = [...featureKeySchema.options];
  const facts = await loadFeatureAccessFacts({ ...input, features });
  const decisions = features.map(
    (feature) =>
      [
        feature,
        resolveFeatureEntitlement({
          feature,
          emergencyDisabled: isEmergencyDisabled(feature),
          userOverride: facts.userOverrides.get(feature) ?? null,
          organizationOverride:
            facts.organizationOverrides.get(feature) ?? null,
          planId: facts.planId,
          planEntitlement: facts.planEntitlements.get(feature) ?? null,
        }),
      ] as const,
  );

  return {
    planId: facts.planId,
    features: Object.fromEntries(decisions) as Record<
      FeatureKey,
      FeatureEntitlementDecision
    >,
  };
}

export async function evaluateFeatureAccess(
  input: FeatureAccessInput,
): Promise<FeatureEntitlementDecision> {
  const snapshot = await getAccessSnapshot(input);
  return snapshot.features[input.feature];
}

/** Product entitlement guard; callers must still enforce role permissions. */
export async function requireFeature(input: FeatureAccessInput) {
  const decision = await evaluateFeatureAccess(input);
  if (!decision.enabled) throw new FeatureAccessError(decision);
  return decision;
}

import { z } from "zod";

/** Roles within a customer organization. Platform admins remain separate. */
export const organizationRoleSchema = z.enum([
  "owner",
  "admin",
  "billing_admin",
  "member",
]);

export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

/** Stable product plan identifiers; billing providers map into these values. */
export const planIdSchema = z.enum(["free", "pro", "team", "enterprise"]);

export type PlanId = z.infer<typeof planIdSchema>;

/**
 * Product features addressable by plans and targeted overrides.
 * Add keys here before persisting or evaluating them elsewhere.
 */
export const featureKeySchema = z.enum(["hosted_codex_subscription"]);

export type FeatureKey = z.infer<typeof featureKeySchema>;

const featureDecisionBase = {
  feature: featureKeySchema,
};

/** Explainable result returned by the future feature-access evaluator. */
export const featureEntitlementDecisionSchema = z.discriminatedUnion("reason", [
  z.object({
    ...featureDecisionBase,
    enabled: z.literal(false),
    reason: z.literal("emergency_disabled"),
  }),
  z.object({
    ...featureDecisionBase,
    enabled: z.boolean(),
    reason: z.literal("user_override"),
  }),
  z.object({
    ...featureDecisionBase,
    enabled: z.boolean(),
    reason: z.literal("organization_override"),
  }),
  z.object({
    ...featureDecisionBase,
    enabled: z.boolean(),
    reason: z.literal("plan_entitlement"),
    planId: planIdSchema,
  }),
  z.object({
    ...featureDecisionBase,
    enabled: z.boolean(),
    reason: z.literal("feature_default"),
  }),
]);

export type FeatureEntitlementDecision = z.infer<
  typeof featureEntitlementDecisionSchema
>;

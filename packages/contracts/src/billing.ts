import { z } from "zod";

import { planIdSchema } from "./entitlements";

/** Plans that can be purchased directly through Stripe Checkout. */
export const selfServePlanIdSchema = z.enum(["pro", "power", "team"]);
export type SelfServePlanId = z.infer<typeof selfServePlanIdSchema>;

export const billingCheckoutRequestSchema = z.object({
  planId: selfServePlanIdSchema,
});
export type BillingCheckoutRequest = z.infer<
  typeof billingCheckoutRequestSchema
>;

/** The plan a signed-in member is billed on, as `GET /api/billing` reports it. */
export const billingStatusSchema = z.object({
  planId: planIdSchema,
  planName: z.string(),
  /** Status of the paid subscription, or null when there is none. */
  status: z.enum(["trialing", "active", "past_due", "canceled"]).nullable(),
  /** Whether this member may create workspaces and run compute. */
  hasAccess: z.boolean(),
  /** Why access is granted: paid, an admin comp, or an application admin. */
  accessSource: z.enum(["subscription", "admin_grant", "admin"]).nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  /** True when a Stripe customer exists, so the portal can be opened. */
  hasStripeCustomer: z.boolean(),
  priceUsdPerMonth: z.number(),
  monthlyComputeHours: z.number().nullable(),
  workspaceLimit: z.number().int().positive(),
  activeWorkspaceLimit: z.number().int().positive(),
});

export type BillingStatus = z.infer<typeof billingStatusSchema>;

/** Error code a gated endpoint returns with HTTP 402. */
export const SUBSCRIPTION_REQUIRED_CODE = "subscription_required";

export const billingRedirectResponseSchema = z.object({
  url: z.string().url(),
});
export type BillingRedirectResponse = z.infer<
  typeof billingRedirectResponseSchema
>;

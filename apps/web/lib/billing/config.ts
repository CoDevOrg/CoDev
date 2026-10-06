import "server-only";

import type { SelfServePlanId } from "@codev/contracts";

/** The $20/month Individual plan is stored as the `pro` plan. */
export const INDIVIDUAL_PLAN_ID = "pro" as const;

/**
 * A Stripe-managed subscription whose period ended this long ago without a
 * renewal webhook is treated as lapsed, so a lost cancellation event cannot
 * leave access open indefinitely.
 */
export const STRIPE_PERIOD_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export class BillingConfigError extends Error {
  readonly status = 503;

  readonly variable: string;

  /** The message reaches the browser, so it never names the variable. */
  constructor(variable: string) {
    super("Billing isn't available right now. Please try again later.");
    this.name = "BillingConfigError";
    this.variable = variable;
    console.error(`Billing is not configured: ${variable} is missing.`);
  }
}

export function requireBillingEnv(
  name:
    | "STRIPE_SECRET_KEY"
    | "STRIPE_WEBHOOK_SECRET"
    | "STRIPE_PRICE_ID_INDIVIDUAL"
    | "STRIPE_PRICE_ID_POWER"
    | "STRIPE_PRICE_ID_TEAM",
  env: Record<string, string | undefined> = process.env,
) {
  const value = env[name]?.trim();
  if (!value) throw new BillingConfigError(name);
  return value;
}

const PRICE_ENV_BY_PLAN: Record<
  SelfServePlanId,
  Parameters<typeof requireBillingEnv>[0]
> = {
  pro: "STRIPE_PRICE_ID_INDIVIDUAL",
  power: "STRIPE_PRICE_ID_POWER",
  team: "STRIPE_PRICE_ID_TEAM",
};

export function stripePriceIdForPlan(planId: SelfServePlanId) {
  return requireBillingEnv(PRICE_ENV_BY_PLAN[planId]);
}

export function selfServePlanIdForStripePrice(priceId: string) {
  return (
    (
      Object.entries(PRICE_ENV_BY_PLAN) as [
        SelfServePlanId,
        (typeof PRICE_ENV_BY_PLAN)[SelfServePlanId],
      ][]
    ).find(([, variable]) => process.env[variable]?.trim() === priceId)?.[0] ??
    null
  );
}

export const GEN2_FREE_LIFETIME_COMPUTE_LIMIT_MS = 5 * 3_600_000;
/** Individual's allowance; retained as a compatibility export for tests/UI. */
export const GEN2_PAID_MONTHLY_COMPUTE_LIMIT_MS = 40 * 3_600_000;
export const GEN2_FREE_OWNER_MONTHLY_BUDGET_CENTS = 650;

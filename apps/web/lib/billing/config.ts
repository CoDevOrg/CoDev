import "server-only";

import type { PlanId } from "@codev/contracts";

/** The $20/month Individual plan is stored as the `pro` plan. */
export const INDIVIDUAL_PLAN_ID: PlanId = "pro";
export const INDIVIDUAL_PLAN_NAME = "Individual";
export const INDIVIDUAL_PRICE_USD_PER_MONTH = 20;

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
    | "STRIPE_PRICE_ID_INDIVIDUAL",
  env: Record<string, string | undefined> = process.env,
) {
  const value = env[name]?.trim();
  if (!value) throw new BillingConfigError(name);
  return value;
}

export const GEN2_PAID_MONTHLY_COMPUTE_LIMIT_MS = 1_000 * 60_000;
export const GEN2_FREE_ONE_WORKSPACE_LIMIT_MS = 50 * 3_600_000;
export const GEN2_FREE_TWO_WORKSPACE_LIMIT_MS = 35 * 3_600_000;
export const GEN2_FREE_OWNER_MONTHLY_BUDGET_CENTS = 650;

import "server-only";

import { eq } from "drizzle-orm";

import {
  SUBSCRIPTION_REQUIRED_CODE,
  type BillingStatus,
} from "@codev/contracts";
import { schema } from "@codev/db";

import { isUserAdmin } from "../admin/admin";
import { getDatabase } from "../platform/database";
import {
  INDIVIDUAL_PLAN_ID,
  INDIVIDUAL_PLAN_NAME,
  INDIVIDUAL_PRICE_USD_PER_MONTH,
  STRIPE_PERIOD_GRACE_MS,
} from "./config";

type SubscriptionRow = typeof schema.organizationSubscriptions.$inferSelect;

export type BillingAccessSource = "subscription" | "admin_grant" | "admin";

/** Thrown at a compute entry point when the workspace owner has no plan. */
export class BillingRequiredError extends Error {
  readonly status = 402;
  readonly code = SUBSCRIPTION_REQUIRED_CODE;

  constructor(
    message = "An active Individual plan is required. Workspace owners can subscribe in Settings > Billing.",
  ) {
    super(message);
    this.name = "BillingRequiredError";
  }

  toResponse() {
    return Response.json(
      { error: this.message, code: this.code },
      { status: this.status },
    );
  }
}

/**
 * Pure access rule. Application admins are exempt. Everyone else needs the
 * Individual plan in `trialing` or `active`. A Stripe-managed row also has to
 * be inside its paid period (plus a short grace) so a lost webhook cannot
 * keep access open forever. Admin comps have no provider and no period.
 */
export function resolveBillingAccess(input: {
  isAdmin: boolean;
  row: Pick<
    SubscriptionRow,
    "planId" | "status" | "provider" | "currentPeriodEnd"
  > | null;
  now?: Date;
}): { hasAccess: boolean; source: BillingAccessSource | null } {
  const row = input.row;
  const paid =
    row &&
    row.planId === INDIVIDUAL_PLAN_ID &&
    (row.status === "active" || row.status === "trialing");
  if (paid) {
    if (row.provider !== "stripe") {
      return { hasAccess: true, source: "admin_grant" };
    }
    const now = (input.now ?? new Date()).getTime();
    const lapsed =
      row.currentPeriodEnd &&
      row.currentPeriodEnd.getTime() + STRIPE_PERIOD_GRACE_MS < now;
    if (!lapsed) return { hasAccess: true, source: "subscription" };
  }
  // An actual subscription is reported as such even for an administrator.
  if (input.isAdmin) return { hasAccess: true, source: "admin" };
  return { hasAccess: false, source: null };
}

/** A user's personal organization id is the user id (see organization-bootstrap). */
export async function getSubscriptionRow(
  userId: string,
): Promise<SubscriptionRow | null> {
  const [row] = await getDatabase()
    .select()
    .from(schema.organizationSubscriptions)
    .where(eq(schema.organizationSubscriptions.organizationId, userId))
    .limit(1);
  return row ?? null;
}

export async function getBillingStatus(userId: string): Promise<BillingStatus> {
  const [row, isAdmin] = await Promise.all([
    getSubscriptionRow(userId),
    isUserAdmin(userId),
  ]);
  const access = resolveBillingAccess({ isAdmin, row });
  const subscribed = row?.planId === INDIVIDUAL_PLAN_ID;
  return {
    planId:
      access.source === "admin" ? INDIVIDUAL_PLAN_ID : (row?.planId ?? "free"),
    planName:
      subscribed || access.source === "admin" ? INDIVIDUAL_PLAN_NAME : "Free",
    status:
      row?.provider === "stripe" || subscribed ? (row?.status ?? null) : null,
    hasAccess: access.hasAccess,
    accessSource: access.source,
    currentPeriodEnd: row?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
    hasStripeCustomer:
      row?.provider === "stripe" && Boolean(row.providerCustomerId),
    priceUsdPerMonth: INDIVIDUAL_PRICE_USD_PER_MONTH,
  };
}

export async function hasIndividualAccess(userId: string) {
  return (await getBillingStatus(userId)).hasAccess;
}

/**
 * The paywall. Call with the workspace *owner's* id at every entry that
 * creates or starts compute; throws a 402 `subscription_required`.
 */
export async function requireIndividualPlan(ownerId: string) {
  const [row, isAdmin] = await Promise.all([
    getSubscriptionRow(ownerId),
    isUserAdmin(ownerId),
  ]);
  if (!resolveBillingAccess({ isAdmin, row }).hasAccess) {
    throw new BillingRequiredError();
  }
}

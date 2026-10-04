import "server-only";

import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import { INDIVIDUAL_PLAN_ID } from "./config";

type SubscriptionStatus =
  (typeof schema.organizationSubscriptions.$inferSelect)["status"];

/**
 * Stripe has more states than the table. `incomplete` (first payment not yet
 * made) returns null: nothing has been bought, so nothing is written.
 */
export function mapStripeStatus(
  status: Stripe.Subscription.Status,
): SubscriptionStatus | null {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null;
  }
}

export function stripeId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** Period end lives on the subscription items in current Stripe API versions. */
export function subscriptionPeriodEnd(
  subscription: Stripe.Subscription,
): Date | null {
  const ends = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === "number");
  if (ends.length === 0) return null;
  return new Date(Math.max(...ends) * 1000);
}

/**
 * Which member a subscription belongs to: the `userId` we stamped on it at
 * checkout, else whoever already owns its customer id.
 */
async function resolveOrganizationId(subscription: Stripe.Subscription) {
  const db = getDatabase();
  const customerId = stripeId(subscription.customer);
  if (customerId) {
    const [byCustomer] = await db
      .select({
        organizationId: schema.organizationSubscriptions.organizationId,
      })
      .from(schema.organizationSubscriptions)
      .where(
        and(
          eq(schema.organizationSubscriptions.provider, "stripe"),
          eq(schema.organizationSubscriptions.providerCustomerId, customerId),
        ),
      )
      .limit(1);
    if (byCustomer) {
      const [member] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, byCustomer.organizationId))
        .limit(1);
      return member?.id ?? null;
    }
  }
  const userId = subscription.metadata?.userId;
  if (!userId) return null;
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return user?.id ?? null;
}

export type SyncResult =
  | { synced: true; organizationId: string; status: SubscriptionStatus }
  | { synced: false; reason: string };

/**
 * Writes a Stripe subscription onto the member's subscription row. Always
 * called with a subscription freshly retrieved from Stripe, never with a
 * webhook payload, so replays and out-of-order events converge on the truth.
 */
export async function syncStripeSubscription(
  subscription: Stripe.Subscription,
): Promise<SyncResult> {
  const status = mapStripeStatus(subscription.status);
  if (!status) return { synced: false, reason: "subscription_incomplete" };

  const organizationId = await resolveOrganizationId(subscription);
  if (!organizationId) {
    logEvent("warn", "billing.subscription.unmatched", {
      subscription: subscription.id,
    });
    return { synced: false, reason: "no_matching_member" };
  }

  const db = getDatabase();
  const [existing] = await db
    .select()
    .from(schema.organizationSubscriptions)
    .where(eq(schema.organizationSubscriptions.organizationId, organizationId))
    .limit(1);

  // A canceled Stripe event must not wipe out a newer subscription or a manual
  // plan grant that replaced the canceled subscription.
  if (
    status === "canceled" &&
    existing?.providerSubscriptionId &&
    ((existing.provider === "stripe" &&
      existing.providerSubscriptionId !== subscription.id &&
      (existing.status === "active" || existing.status === "trialing")) ||
      (existing.provider !== "stripe" &&
        existing.planId !== "free" &&
        existing.providerSubscriptionId === subscription.id))
  ) {
    return { synced: false, reason: "superseded_subscription" };
  }

  const customerId = stripeId(subscription.customer);
  const periodEnd = subscriptionPeriodEnd(subscription);
  const values = {
    // A canceled subscription drops the member back to Free.
    planId: status === "canceled" ? ("free" as const) : INDIVIDUAL_PLAN_ID,
    status,
    provider: "stripe",
    providerCustomerId: customerId,
    providerSubscriptionId: subscription.id,
    currentPeriodEnd: periodEnd,
    canceledAt: subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000)
      : null,
    cancelAtPeriodEnd:
      subscription.cancel_at_period_end || subscription.cancel_at !== null,
    updatedAt: new Date(),
  };

  await db
    .insert(schema.organizationSubscriptions)
    .values({ organizationId, ...values })
    .onConflictDoUpdate({
      target: schema.organizationSubscriptions.organizationId,
      set: values,
    });
  logEvent("info", "billing.subscription.synced", {
    organizationId,
    subscription: subscription.id,
    status,
  });
  return { synced: true, organizationId, status };
}

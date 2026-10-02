import "server-only";

import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { ApiError } from "../http/api-route";
import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import { getSubscriptionRow, resolveBillingAccess } from "./access";
import { requireBillingEnv } from "./config";
import { getStripe } from "./stripe";
import { stripeId, syncStripeSubscription } from "./subscriptions";

export const BILLING_PATH = "/settings/personal/billing";

type Member = { id: string; email?: string | null; name?: string | null };

/**
 * The member's Stripe customer, created once and remembered on their
 * subscription row so a second click never makes a second customer.
 */
async function ensureStripeCustomer(member: Member) {
  const existing = await getSubscriptionRow(member.id);
  if (existing?.provider === "stripe" && existing.providerCustomerId) {
    // The stored customer can belong to the other Stripe mode (sandbox vs
    // live) or have been deleted; only reuse it when this account has it.
    const known = await getStripe()
      .customers.retrieve(existing.providerCustomerId)
      .then((customer) => !("deleted" in customer && customer.deleted))
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === "resource_missing") {
          return false;
        }
        throw error;
      });
    if (known) return existing.providerCustomerId;
  }
  // A second click must not make a second customer, so a first creation is
  // idempotent. A replacement can't reuse the key (it would replay the old one).
  const replacing = Boolean(existing?.providerCustomerId);
  const customer = await getStripe().customers.create(
    {
      ...(member.email ? { email: member.email } : {}),
      ...(member.name ? { name: member.name } : {}),
      metadata: { userId: member.id },
    },
    replacing ? {} : { idempotencyKey: `codev-customer-${member.id}` },
  );
  const db = getDatabase();
  if (existing) {
    await db
      .update(schema.organizationSubscriptions)
      .set({
        provider: "stripe",
        providerCustomerId: customer.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.organizationSubscriptions.organizationId, member.id));
  } else {
    await db
      .insert(schema.organizationSubscriptions)
      .values({
        organizationId: member.id,
        planId: "free",
        status: "active",
        provider: "stripe",
        providerCustomerId: customer.id,
      })
      .onConflictDoNothing();
  }
  return customer.id;
}

/** Starts a Stripe Checkout for the $20/month Individual plan. */
export async function createCheckoutSession(member: Member, origin: string) {
  const row = await getSubscriptionRow(member.id);
  // Admins are exempt from the paywall but may still subscribe (to test it).
  const access = resolveBillingAccess({ isAdmin: false, row });
  if (access.hasAccess) {
    throw new ApiError(
      access.source === "subscription"
        ? "You already have an active Individual plan. Use Manage billing to change it."
        : "Your account already includes the Individual plan.",
      409,
    );
  }
  const priceId = requireBillingEnv("STRIPE_PRICE_ID_INDIVIDUAL");
  const customerId = await ensureStripeCustomer(member);
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: member.id,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { metadata: { userId: member.id } },
    metadata: { userId: member.id },
    allow_promotion_codes: true,
    success_url: `${origin}${BILLING_PATH}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}${BILLING_PATH}?checkout=canceled`,
  });
  if (!session.url)
    throw new ApiError("Stripe did not return a checkout URL.", 502);
  logEvent("info", "billing.checkout.created", { userId: member.id });
  return session.url;
}

/** Opens the Stripe Customer Portal (update card, invoices, cancel). */
export async function createPortalSession(memberId: string, origin: string) {
  const row = await getSubscriptionRow(memberId);
  if (row?.provider !== "stripe" || !row.providerCustomerId) {
    throw new ApiError("There is no billing account to manage yet.", 409);
  }
  const configuration = process.env.STRIPE_PORTAL_CONFIGURATION_ID?.trim();
  const session = await getStripe().billingPortal.sessions.create({
    customer: row.providerCustomerId,
    return_url: `${origin}${BILLING_PATH}`,
    ...(configuration ? { configuration } : {}),
  });
  return session.url;
}

/**
 * Called when the member lands back from Checkout. Syncing here means access
 * is immediate even if the webhook is a moment behind. The session must
 * belong to this member; anything else is ignored.
 */
export async function syncCheckoutSession(memberId: string, sessionId: string) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return false;
  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  if (
    session.client_reference_id !== memberId ||
    session.mode !== "subscription" ||
    session.status !== "complete"
  ) {
    return false;
  }
  const subscriptionId = stripeId(session.subscription);
  if (!subscriptionId) return false;
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const result = await syncStripeSubscription(subscription);
  return result.synced;
}

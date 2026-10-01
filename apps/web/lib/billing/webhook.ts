import "server-only";

import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import { getStripe } from "./stripe";
import { stripeId, syncStripeSubscription } from "./subscriptions";

/** The subscription an event is about, whatever the event's object type. */
export function subscriptionIdForEvent(event: Stripe.Event): string | null {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return event.data.object.id;
    case "checkout.session.completed": {
      const session = event.data.object;
      return session.mode === "subscription"
        ? stripeId(session.subscription)
        : null;
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice & {
        subscription?: string | { id: string } | null;
      };
      // Newer API versions nest it under `parent`; older ones had it on the invoice.
      return (
        stripeId(invoice.parent?.subscription_details?.subscription) ??
        stripeId(invoice.subscription)
      );
    }
    default:
      return null;
  }
}

export const HANDLED_STRIPE_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

/**
 * Applies one verified webhook event. The subscription is re-read from Stripe
 * rather than trusted from the payload, so a replayed or late event can only
 * ever write the current state. Redelivered event ids are skipped.
 */
export async function handleStripeEvent(
  event: Stripe.Event,
): Promise<{ handled: boolean; reason?: string }> {
  const db = getDatabase();
  const [seen] = await db
    .select({ id: schema.stripeWebhookEvents.id })
    .from(schema.stripeWebhookEvents)
    .where(eq(schema.stripeWebhookEvents.id, event.id))
    .limit(1);
  if (seen) return { handled: false, reason: "duplicate" };

  const subscriptionId = subscriptionIdForEvent(event);
  let outcome: { handled: boolean; reason?: string } = {
    handled: false,
    reason: "ignored_event",
  };
  if (subscriptionId) {
    const subscription =
      await getStripe().subscriptions.retrieve(subscriptionId);
    const result = await syncStripeSubscription(subscription);
    outcome = result.synced
      ? { handled: true }
      : { handled: false, reason: result.reason };
  }

  await db
    .insert(schema.stripeWebhookEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing();
  logEvent("info", "billing.webhook.processed", {
    event: event.id,
    type: event.type,
    handled: outcome.handled,
    reason: outcome.reason ?? null,
  });
  return outcome;
}

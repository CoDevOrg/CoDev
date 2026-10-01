import Stripe from "stripe";

import { requireBillingEnv } from "@/lib/billing/config";
import { handleStripeEvent } from "@/lib/billing/webhook";
import { logEvent } from "@/lib/platform/observability";

/**
 * Stripe calls this, not a browser: there is no session. The signature over
 * the raw body is the authentication.
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing signature." }, { status: 400 });
  }
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = await Stripe.webhooks.constructEventAsync(
      body,
      signature,
      requireBillingEnv("STRIPE_WEBHOOK_SECRET"),
    );
  } catch (error) {
    if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
      return Response.json({ error: "Invalid signature." }, { status: 400 });
    }
    throw error;
  }

  try {
    const outcome = await handleStripeEvent(event);
    return Response.json({ received: true, ...outcome });
  } catch (error) {
    // 500 makes Stripe retry with backoff.
    logEvent("error", "billing.webhook.failed", {
      event: event.id,
      type: event.type,
      detail: error instanceof Error ? error.message : "unknown",
    });
    return Response.json(
      { error: "Webhook processing failed." },
      { status: 500 },
    );
  }
}

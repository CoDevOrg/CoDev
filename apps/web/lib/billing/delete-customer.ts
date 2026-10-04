import "server-only";

import { getStripe } from "./stripe";

/** Expire pending checkouts, then remove the customer and cancel all renewals. */
export async function deleteBillingCustomer(customerId: string) {
  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(customerId);
  if ("deleted" in customer && customer.deleted) return;
  for await (const session of stripe.checkout.sessions.list({
    customer: customerId,
    status: "open",
    limit: 100,
  })) {
    await stripe.checkout.sessions.expire(session.id);
  }
  // Stripe customer deletion immediately cancels subscriptions and removes cards.
  // Fail closed on missing/wrong-mode customers rather than leave live billing behind.
  await stripe.customers.del(customerId);
}

import { withUser } from "@/lib/http/api-route";
import { createCheckoutSession } from "@/lib/billing/checkout";

/** Returns the Stripe Checkout URL for the Individual plan. */
export const POST = withUser(
  async ({ request, user }) => {
    const url = await createCheckoutSession(user, new URL(request.url).origin);
    return Response.json({ url });
  },
  { errorStatus: 502 },
);

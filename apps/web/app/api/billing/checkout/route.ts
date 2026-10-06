import { billingCheckoutRequestSchema } from "@codev/contracts";

import { withUser } from "@/lib/http/api-route";
import { createCheckoutSession } from "@/lib/billing/checkout";

/** Returns the Stripe Checkout URL for the selected self-serve plan. */
export const POST = withUser(
  async ({ request, user }) => {
    const input = billingCheckoutRequestSchema.parse(await request.json());
    const url = await createCheckoutSession(
      user,
      new URL(request.url).origin,
      input.planId,
    );
    return Response.json({ url });
  },
  { errorStatus: 502 },
);

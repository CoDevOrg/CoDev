import { withUser } from "@/lib/http/api-route";
import { createPortalSession } from "@/lib/billing/checkout";

/** Returns the Stripe Customer Portal URL for the signed-in member. */
export const POST = withUser(
  async ({ request, user }) => {
    const url = await createPortalSession(user.id, new URL(request.url).origin);
    return Response.json({ url });
  },
  { errorStatus: 502 },
);

import { withUser } from "@/lib/http/api-route";
import { getBillingStatus } from "@/lib/billing/access";

export const GET = withUser(
  async ({ user }) => Response.json(await getBillingStatus(user.id)),
  { errorStatus: 500 },
);

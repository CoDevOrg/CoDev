import { withUser } from "@/lib/http/api-route";
import { getGen2HomeSnapshot } from "@/lib/gen2/home-snapshot";

/**
 * The workspace home's live data. Kept off `/api/gen2/workspaces`, whose edge
 * rate limit also guards workspace creation, so polling cannot block a create.
 */
export const GET = withUser(
  async ({ user }) =>
    Response.json(await getGen2HomeSnapshot(user.id), {
      headers: { "Cache-Control": "private, no-store" },
    }),
  { errorStatus: 500 },
);

import { getGen2SupersetHealth } from "@/lib/gen2/superset";
import { withUser } from "@/lib/http/api-route";

type Params = { workspaceId: string };

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId } }) =>
    Response.json(await getGen2SupersetHealth(workspaceId, user.id), {
      headers: { "Cache-Control": "no-store" },
    }),
  { errorStatus: 502 },
);

import { withUser } from "@/lib/http/api-route";
import { listGen2RemoteBranches } from "@/lib/gen2/remote-branches";

type Params = { workspaceId: string };

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId } }) =>
    Response.json(await listGen2RemoteBranches(workspaceId, user.id), {
      headers: { "Cache-Control": "private, no-store" },
    }),
  { errorStatus: 502 },
);

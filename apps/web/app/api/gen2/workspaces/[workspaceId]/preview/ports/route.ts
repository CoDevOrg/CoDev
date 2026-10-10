import { withUser } from "@/lib/http/api-route";
import { listGen2WorkspacePorts } from "@/lib/gen2/workspace-ports";

type Params = { workspaceId: string };

/** Dev servers an editor can preview; never wakes the guest or counts as activity. */
export const GET = withUser<Params>(
  async ({ user, params: { workspaceId } }) =>
    Response.json(await listGen2WorkspacePorts(workspaceId, user.id), {
      headers: { "Cache-Control": "no-store" },
    }),
  { errorStatus: 502 },
);

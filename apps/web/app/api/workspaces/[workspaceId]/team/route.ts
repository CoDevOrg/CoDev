import { memberStatusSchema } from "@codev/contracts";

import { withWorkspace } from "@/lib/http/api-route";
import { getTeamRoster, setMemberStatus } from "@/lib/chat/team-roster";

export const GET = withWorkspace("view", async ({ user, workspaceId }) =>
  Response.json(await getTeamRoster(workspaceId, user.id)),
);

/** A member sets only their own status; there is no field for anyone else's. */
export const POST = withWorkspace(
  "view",
  async ({ request, user, workspaceId }) => {
    const input = memberStatusSchema.parse(await request.json());
    return Response.json(await setMemberStatus(workspaceId, user.id, input));
  },
);

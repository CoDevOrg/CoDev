import { withUser } from "@/lib/http/api-route";
import { getGen2MemberConnectionStatuses } from "@/lib/gen2/workspaces";

type Params = { workspaceId: string };

export const GET = withUser<Params>(async ({ user, params: { workspaceId } }) =>
  Response.json({
    members: await getGen2MemberConnectionStatuses(workspaceId, user.id),
  }),
);

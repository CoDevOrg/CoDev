import { withUser } from "@/lib/http/api-route";
import { requireGen2Member } from "@/lib/gen2/workspaces";
import { listActiveGen2SupersetRuns } from "@/lib/gen2/superset-runs";

type Params = { workspaceId: string };

export const maxDuration = 60;

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId } }) => {
    await requireGen2Member(workspaceId, user.id);
    const runs = await listActiveGen2SupersetRuns(workspaceId);
    return Response.json({ runs });
  },
  { errorStatus: 502 },
);

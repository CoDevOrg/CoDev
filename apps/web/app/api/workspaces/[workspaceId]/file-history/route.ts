import { ApiError, withUser } from "@/lib/http/api-route";
import { getWorkspaceFileHistory } from "@/lib/workspaces/workspace-restore";

export const GET = withUser<{ workspaceId: string }>(
  async ({ request, user, params: { workspaceId } }) => {
    const path = new URL(request.url).searchParams.get("path");
    if (!path) throw new ApiError("A file path is required.", 400);
    return Response.json({
      entries: await getWorkspaceFileHistory(workspaceId, user.id, path),
    });
  },
  { errorStatus: 502 },
);

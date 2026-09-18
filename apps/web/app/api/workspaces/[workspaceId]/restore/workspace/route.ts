import { z } from "zod";

import { readJson, withUser } from "@/lib/http/api-route";
import { restoreWorkspaceToRevision } from "@/lib/workspaces/workspace-restore";

const bodySchema = z.object({
  revision: z.string().min(7).max(40),
});

export const POST = withUser<{ workspaceId: string }>(
  async ({ request, user, params: { workspaceId } }) => {
    const body = await readJson(request, bodySchema);
    return Response.json(
      await restoreWorkspaceToRevision(workspaceId, user.id, body),
    );
  },
  { errorStatus: 502 },
);

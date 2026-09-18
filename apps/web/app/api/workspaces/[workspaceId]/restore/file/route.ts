import { z } from "zod";

import { readJson, withUser } from "@/lib/api-route";
import { restoreWorkspaceFile } from "@/lib/workspace-restore";

const bodySchema = z.object({
  path: z.string().min(1).max(4_096),
  revision: z.string().min(7).max(40),
});

export const POST = withUser<{ workspaceId: string }>(
  async ({ request, user, params: { workspaceId } }) => {
    const body = await readJson(request, bodySchema);
    return Response.json(
      await restoreWorkspaceFile(workspaceId, user.id, body),
    );
  },
  { errorStatus: 502 },
);

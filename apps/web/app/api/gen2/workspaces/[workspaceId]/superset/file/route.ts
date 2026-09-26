import {
  gen2SupersetSaveFileRequestSchema,
  gen2SupersetWorktreeIdSchema,
} from "@codev/contracts";

import {
  readGen2SupersetFile,
  saveGen2SupersetFile,
} from "@/lib/gen2/superset";
import { ApiError, readJson, withUser } from "@/lib/http/api-route";

type Params = { workspaceId: string };

export const maxDuration = 60;

export const GET = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const query = new URL(request.url).searchParams;
    const worktreeId = gen2SupersetWorktreeIdSchema.safeParse(
      query.get("worktreeId"),
    );
    const path = query.get("path");
    if (!worktreeId.success || !path)
      throw new ApiError("Invalid file request.");
    return Response.json({
      file: await readGen2SupersetFile(
        workspaceId,
        user.id,
        worktreeId.data,
        path,
      ),
    });
  },
  { errorStatus: 502 },
);

export const PUT = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const input = await readJson(request, gen2SupersetSaveFileRequestSchema);
    return Response.json({
      file: await saveGen2SupersetFile(workspaceId, user.id, input),
    });
  },
  { errorStatus: 502 },
);

import { gen2FilePathSchema, gen2GitOperationSchema } from "@codev/contracts";

import { ApiError, withUser } from "@/lib/http/api-route";
import { getGen2Git, showGen2HeadFile } from "@/lib/gen2/workbench";

export const maxDuration = 60;

type Params = { workspaceId: string };

export const GET = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const url = new URL(request.url);
    const operation = gen2GitOperationSchema.safeParse(
      url.searchParams.get("operation"),
    );
    if (!operation.success) {
      throw new ApiError("operation must be status, diff, or show.", 400);
    }
    if (operation.data === "show") {
      const path = gen2FilePathSchema.safeParse(url.searchParams.get("path"));
      if (!path.success) {
        throw new ApiError("A valid workspace path is required.", 400);
      }
      return Response.json(
        await showGen2HeadFile(workspaceId, user.id, path.data),
      );
    }
    return Response.json({
      output: await getGen2Git(workspaceId, user.id, operation.data),
    });
  },
  { errorStatus: 502 },
);

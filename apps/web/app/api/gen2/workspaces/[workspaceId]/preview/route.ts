import { gen2PreviewSessionRequestSchema } from "@codev/contracts";

import { readJson, withUser } from "@/lib/http/api-route";
import { createGen2PreviewSession } from "@/lib/gen2/workspace-preview";

type Params = { workspaceId: string };

/** Mints a short-lived session URL for one port of the workspace's guest. */
export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const session = await createGen2PreviewSession({
      workspaceId,
      userId: user.id,
      origin: request.headers.get("origin"),
      request: await readJson(request, gen2PreviewSessionRequestSchema),
    });
    return Response.json(session, {
      headers: { "Cache-Control": "no-store" },
    });
  },
  { errorStatus: 500 },
);

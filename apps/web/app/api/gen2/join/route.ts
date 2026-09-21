import { gen2JoinRequestSchema } from "@codev/contracts";

import { withUser, readJson } from "@/lib/http/api-route";
import { joinGen2Workspace } from "@/lib/gen2/workspaces";

export const POST = withUser(async ({ request, user }) => {
  const input = await readJson(request, gen2JoinRequestSchema);
  const workspace = await joinGen2Workspace(input.token, user.id);
  return Response.json({ workspace });
});

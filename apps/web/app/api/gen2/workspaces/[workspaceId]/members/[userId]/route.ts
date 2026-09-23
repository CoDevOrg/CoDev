import { gen2MemberRoleMutationSchema } from "@codev/contracts";

import { readJson, withUser } from "@/lib/http/api-route";
import { changeGen2MemberRole, removeGen2Member } from "@/lib/gen2/workspaces";

type Params = { workspaceId: string; userId: string };

export const PATCH = withUser<Params>(async ({ request, user, params }) => {
  const input = await readJson(request, gen2MemberRoleMutationSchema);
  return Response.json({
    member: await changeGen2MemberRole({
      workspaceId: params.workspaceId,
      userId: user.id,
      targetUserId: params.userId,
      role: input.role,
    }),
  });
});

export const DELETE = withUser<Params>(async ({ user, params }) => {
  await removeGen2Member({
    workspaceId: params.workspaceId,
    userId: user.id,
    targetUserId: params.userId,
  });
  return Response.json({ ok: true });
});

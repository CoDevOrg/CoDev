import { withUser } from "@/lib/http/api-route";
import {
  removeGen2WorkspaceMember,
  updateGen2WorkspaceMemberRole,
} from "@/lib/gen2/workspaces";
import { gen2UpdateMemberRoleRequestSchema } from "@codev/contracts";

type Params = { workspaceId: string; memberUserId: string };

export const PATCH = withUser<Params>(
  async ({ request, user, params: { workspaceId, memberUserId } }) => {
    const body = (await request.json().catch(() => ({}))) as unknown;
    const parsed = gen2UpdateMemberRoleRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Provide a valid role (owner, editor, or viewer)." },
        { status: 400 },
      );
    }
    const members = await updateGen2WorkspaceMemberRole(
      workspaceId,
      user.id,
      memberUserId,
      parsed.data.role,
    );
    return Response.json({ members });
  },
);

export const DELETE = withUser<Params>(
  async ({ user, params: { workspaceId, memberUserId } }) => {
    const members = await removeGen2WorkspaceMember(
      workspaceId,
      user.id,
      memberUserId,
    );
    return Response.json({ members });
  },
);

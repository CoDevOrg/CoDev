import { withUser } from "@/lib/http/api-route";
import {
  addGen2WorkspaceMember,
  getGen2WorkspaceMembers,
} from "@/lib/gen2/workspaces";
import { gen2AddMemberRequestSchema } from "@codev/contracts";

type Params = { workspaceId: string };

export const GET = withUser<Params>(
  async ({ user, params: { workspaceId } }) => {
    const data = await getGen2WorkspaceMembers(workspaceId, user.id);
    return Response.json(data);
  },
);

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const body = (await request.json().catch(() => ({}))) as unknown;
    const parsed = gen2AddMemberRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Provide a valid email or username and role." },
        { status: 400 },
      );
    }
    const members = await addGen2WorkspaceMember(
      workspaceId,
      user.id,
      parsed.data.emailOrLogin,
      parsed.data.role,
    );
    return Response.json({ members });
  },
);

import { withUser } from "@/lib/http/api-route";
import {
  createGen2ShareLink,
  revokeGen2ShareLink,
} from "@/lib/gen2/workspaces";

type Params = { workspaceId: string };

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const origin = new URL(request.url).origin;
    return Response.json(
      await createGen2ShareLink(workspaceId, user.id, origin),
    );
  },
);

export const DELETE = withUser<Params>(
  async ({ user, params: { workspaceId } }) => {
    await revokeGen2ShareLink(workspaceId, user.id);
    return Response.json({ ok: true });
  },
);

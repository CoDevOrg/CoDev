import { ApiError, withUser } from "@/lib/http/api-route";
import { createGen2ShareLink, getGen2ActiveShare } from "@/lib/gen2/workspaces";
import { gen2ShareRequestSchema } from "@codev/contracts";

type Params = { workspaceId: string };

export const GET = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const origin = new URL(request.url).origin;
    const share = await getGen2ActiveShare(workspaceId, user.id, origin);
    return Response.json(share ?? { active: false });
  },
);

export const POST = withUser<Params>(
  async ({ request, user, params: { workspaceId } }) => {
    const origin = new URL(request.url).origin;
    const body = (await request.json().catch(() => ({}))) as unknown;
    const parsed = gen2ShareRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new ApiError("Share links invite editors or viewers.", 400);
    const role = parsed.data.role;
    return Response.json(
      await createGen2ShareLink(workspaceId, user.id, origin, role),
    );
  },
);

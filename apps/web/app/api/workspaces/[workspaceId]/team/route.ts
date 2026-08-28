import { memberStatusSchema } from "@codev/contracts";

import { requireWorkspacePermission } from "@/lib/access";
import { apiError, getApiUser } from "@/lib/api";
import { getTeamRoster, setMemberStatus } from "@/lib/team-roster";

type Context = { params: Promise<{ workspaceId: string }> };

function statusFor(error: unknown, fallback = 400) {
  return error instanceof Error && "status" in error
    ? Number(error.status)
    : fallback;
}

export async function GET(_request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    return Response.json(await getTeamRoster(workspaceId, user.id));
  } catch (error) {
    return apiError(error, statusFor(error));
  }
}

/** A member sets only their own status; there is no field for anyone else's. */
export async function POST(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    const input = memberStatusSchema.parse(await request.json());
    return Response.json(await setMemberStatus(workspaceId, user.id, input));
  } catch (error) {
    return apiError(error, statusFor(error));
  }
}

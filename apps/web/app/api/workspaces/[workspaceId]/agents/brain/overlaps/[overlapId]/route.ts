import { updateBrainOverlapSchema } from "@codev/contracts";

import { requireWorkspacePermission } from "@/lib/access";
import { apiError, getApiUser } from "@/lib/api";
import { updateOverlapStatus } from "@/lib/workspace-brain";

type Context = {
  params: Promise<{ workspaceId: string; overlapId: string }>;
};

export async function PATCH(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId, overlapId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "coSteer");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error
        ? Number((error as { status: unknown }).status)
        : 403,
    );
  }
  try {
    const { status } = updateBrainOverlapSchema.parse(await request.json());
    return Response.json({
      overlap: await updateOverlapStatus(workspaceId, overlapId, status),
    });
  } catch (error) {
    return apiError(error, 400);
  }
}

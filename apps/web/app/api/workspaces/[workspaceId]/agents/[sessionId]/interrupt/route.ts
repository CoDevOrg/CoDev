import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import {
  SharedSessionError,
  interruptSharedSession,
} from "@/lib/shared-session-server";

export async function POST(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ workspaceId: string; sessionId: string }>;
  },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId, sessionId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "coSteer");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }

  try {
    return Response.json(
      await interruptSharedSession(workspaceId, sessionId, user),
    );
  } catch (error) {
    if (error instanceof SharedSessionError) {
      return apiError(error, error.status);
    }
    return apiError(error);
  }
}

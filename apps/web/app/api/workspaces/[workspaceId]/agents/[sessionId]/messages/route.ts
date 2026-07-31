import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import {
  createCoordinationMessage,
  listCoordinationMessages,
} from "@/lib/agent-coordination";

type Context = {
  params: Promise<{ workspaceId: string; sessionId: string }>;
};

export async function GET(_request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId, sessionId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }
  try {
    return Response.json({
      messages: await listCoordinationMessages(workspaceId, sessionId),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
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
    const message = await createCoordinationMessage(
      workspaceId,
      sessionId,
      await request.json(),
    );
    return Response.json({ message }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

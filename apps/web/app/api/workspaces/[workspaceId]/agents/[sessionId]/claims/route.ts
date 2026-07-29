import { apiError, getApiUser } from "@/lib/api";
import {
  CoordinationConflictError,
  createPathClaim,
  listPathClaims,
} from "@/lib/agent-coordination";
import { getWorkspaceForMember } from "@/lib/workspaces";

type Context = {
  params: Promise<{ workspaceId: string; sessionId: string }>;
};

export async function GET(_request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId, sessionId } = await params;
  if (!(await getWorkspaceForMember(workspaceId, user.id))) {
    return apiError(new Error("Workspace not found."), 404);
  }
  try {
    return Response.json({
      claims: await listPathClaims(workspaceId, sessionId),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId, sessionId } = await params;
  if (!(await getWorkspaceForMember(workspaceId, user.id))) {
    return apiError(new Error("Workspace not found."), 404);
  }
  try {
    const claim = await createPathClaim(
      workspaceId,
      sessionId,
      await request.json(),
    );
    return Response.json({ claim }, { status: 201 });
  } catch (error) {
    return apiError(
      error,
      error instanceof CoordinationConflictError ? 409 : 400,
    );
  }
}

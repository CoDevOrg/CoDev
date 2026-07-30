import { apiError, getApiUser } from "@/lib/api";
import { listWorkspaceEvents } from "@/lib/audit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  const events = await listWorkspaceEvents(workspaceId, user.id);
  return Response.json({ events });
}

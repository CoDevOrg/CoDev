import { requireWorkspacePermission } from "@/lib/access";
import { apiError, getApiUser } from "@/lib/api";
import {
  listBrainEntries,
  listWorkspaceBriefs,
  listWorkspaceOverlaps,
} from "@/lib/workspace-brain";

type Context = {
  params: Promise<{ workspaceId: string }>;
};

/**
 * The read model Mission Control renders: every live agent's brief, the
 * open overlap warnings between them, and the recent workspace history.
 */
export async function GET(_request: Request, { params }: Context) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error
        ? Number((error as { status: unknown }).status)
        : 403,
    );
  }
  try {
    const [briefs, overlaps, entries] = await Promise.all([
      listWorkspaceBriefs(workspaceId),
      listWorkspaceOverlaps(workspaceId),
      listBrainEntries(workspaceId, { limit: 40 }),
    ]);
    return Response.json({ briefs, overlaps, entries });
  } catch (error) {
    return apiError(error);
  }
}

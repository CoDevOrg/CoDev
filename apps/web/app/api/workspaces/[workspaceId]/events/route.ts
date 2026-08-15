import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { loadActivityAuditSnapshot } from "@/lib/activity-audit-server";
import type { ActivityFilterKind } from "@/lib/activity-audit-view";

const FILTER_KINDS = new Set<ActivityFilterKind>([
  "all",
  "file",
  "session",
  "diff",
]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  const url = new URL(request.url);
  const kindParam = url.searchParams.get("kind");
  const query = url.searchParams.get("query") ?? "";
  const kind =
    kindParam && FILTER_KINDS.has(kindParam as ActivityFilterKind)
      ? (kindParam as ActivityFilterKind)
      : "all";
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    return Response.json(
      await loadActivityAuditSnapshot(workspaceId, user, { kind, query }),
    );
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 502,
    );
  }
}

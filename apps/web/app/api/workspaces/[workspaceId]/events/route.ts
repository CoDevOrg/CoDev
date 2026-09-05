import { apiError, getApiUserAnyAuth } from "@/lib/api";
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
  const user = await getApiUserAnyAuth(request);
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  const url = new URL(request.url);
  const kindParam = url.searchParams.get("kind");
  const query = url.searchParams.get("query") ?? "";
  const kind =
    kindParam && FILTER_KINDS.has(kindParam as ActivityFilterKind)
      ? (kindParam as ActivityFilterKind)
      : "all";
  const beforeParam = url.searchParams.get("before");
  const beforeSequence =
    beforeParam && /^\d+$/.test(beforeParam) ? Number(beforeParam) : undefined;
  const limitParam = url.searchParams.get("limit");
  const limit =
    limitParam && /^\d+$/.test(limitParam) ? Number(limitParam) : undefined;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
    return Response.json(
      await loadActivityAuditSnapshot(workspaceId, user, {
        kind,
        query,
        ...(beforeSequence !== undefined ? { beforeSequence } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }),
    );
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 502,
    );
  }
}

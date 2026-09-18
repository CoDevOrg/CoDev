import { withWorkspace } from "@/lib/api-route";
import { loadActivityAuditSnapshot } from "@/lib/activity-audit-server";
import type { ActivityFilterKind } from "@/lib/activity-audit-view";

const FILTER_KINDS = new Set<ActivityFilterKind>([
  "all",
  "file",
  "session",
  "diff",
]);

export const GET = withWorkspace(
  "view",
  async ({ request, user, workspaceId }) => {
    const url = new URL(request.url);
    const kindParam = url.searchParams.get("kind");
    const query = url.searchParams.get("query") ?? "";
    const kind =
      kindParam && FILTER_KINDS.has(kindParam as ActivityFilterKind)
        ? (kindParam as ActivityFilterKind)
        : "all";
    const beforeParam = url.searchParams.get("before");
    const beforeSequence =
      beforeParam && /^\d+$/.test(beforeParam)
        ? Number(beforeParam)
        : undefined;
    const limitParam = url.searchParams.get("limit");
    const limit =
      limitParam && /^\d+$/.test(limitParam) ? Number(limitParam) : undefined;
    return Response.json(
      await loadActivityAuditSnapshot(workspaceId, user, {
        kind,
        query,
        ...(beforeSequence !== undefined ? { beforeSequence } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }),
    );
  },
  { anyAuth: true, errorStatus: 502 },
);

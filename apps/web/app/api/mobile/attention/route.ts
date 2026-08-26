import { and, eq, inArray, isNotNull, or } from "drizzle-orm";

import { schema } from "@codev/db";

import { apiError, getApiUserAnyAuth } from "@/lib/api";
import { getDatabase } from "@/lib/database";

/**
 * Combined "needs your attention" list across every workspace the caller is
 * a member of: agent sessions that are waiting for review, have failed, or
 * went idle with a lingering per-turn error. Backs the mobile notification
 * inbox and home-screen badge without the client fetching every workspace's
 * every session on each poll.
 */
export async function GET(request: Request) {
  const user = await getApiUserAnyAuth(request);
  if (!user) return apiError(new Error("Authentication required."), 401);

  const rows = await getDatabase()
    .select({
      workspaceId: schema.agentSessions.workspaceId,
      sessionId: schema.agentSessions.id,
      sessionName: schema.agentSessions.name,
      status: schema.agentSessions.status,
      lastError: schema.agentSessions.lastError,
      updatedAt: schema.agentSessions.updatedAt,
      repository: schema.workspaces.repository,
    })
    .from(schema.agentSessions)
    .innerJoin(
      schema.workspaceMembers,
      eq(schema.workspaceMembers.workspaceId, schema.agentSessions.workspaceId),
    )
    .innerJoin(
      schema.workspaces,
      eq(schema.workspaces.id, schema.agentSessions.workspaceId),
    )
    .where(
      and(
        eq(schema.workspaceMembers.userId, user.id),
        or(
          inArray(schema.agentSessions.status, ["waiting", "failed"]),
          and(
            eq(schema.agentSessions.status, "idle"),
            isNotNull(schema.agentSessions.lastError),
          ),
        ),
      ),
    )
    .orderBy(schema.agentSessions.updatedAt);

  return Response.json({ items: rows });
}

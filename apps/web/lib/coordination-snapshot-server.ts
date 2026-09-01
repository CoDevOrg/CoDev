import "server-only";

import { schema } from "@codev/db";
import { eq } from "drizzle-orm";

import { listWorkspaceLivePathClaims } from "./agent-coordination";
import {
  toCoordinationSnapshot,
  type CoordinationSnapshot,
} from "./coordination-snapshot";
import { getDatabase } from "./database";
import { displayMemberName } from "./shared-session-view";
import { listWorkspaceOverlaps } from "./workspace-brain";

/**
 * Load what the workspace's agents are actually holding and colliding over.
 *
 * Every session in the workspace is listed, `cli` included — the CLI agents are
 * the ones writing claims through the coordination MCP, and `listAgentSessions`
 * deliberately excludes them because they take no managed slot. Reusing that
 * here would leave every CLI claim ownerless, which is the whole population this
 * exists to show.
 */
export async function loadWorkspaceCoordinationSnapshot(
  workspaceId: string,
): Promise<CoordinationSnapshot> {
  const [claims, sessions, overlaps] = await Promise.all([
    listWorkspaceLivePathClaims(workspaceId),
    getDatabase()
      .select({
        id: schema.agentSessions.id,
        name: schema.agentSessions.name,
        provider: schema.agentSessions.provider,
        kind: schema.agentSessions.kind,
        worktreeId: schema.agentSessions.worktreeId,
        worktreeName: schema.worktrees.name,
        ownerName: schema.users.name,
        ownerLogin: schema.users.login,
      })
      .from(schema.agentSessions)
      .leftJoin(
        schema.worktrees,
        eq(schema.agentSessions.worktreeId, schema.worktrees.id),
      )
      .leftJoin(
        schema.users,
        eq(schema.agentSessions.createdBy, schema.users.id),
      )
      .where(eq(schema.agentSessions.workspaceId, workspaceId)),
    listWorkspaceOverlaps(workspaceId),
  ]);

  return toCoordinationSnapshot({
    claims,
    sessions: sessions.map((session) => ({
      id: session.id,
      name: session.name,
      provider: session.provider,
      kind: session.kind,
      worktreeId: session.worktreeId,
      worktreeName: session.worktreeName,
      ownerName: displayMemberName(
        session.ownerName,
        session.ownerLogin ?? undefined,
      ),
    })),
    overlaps: overlaps.map((overlap) => ({
      id: overlap.id,
      leftSessionId: overlap.leftSessionId,
      rightSessionId: overlap.rightSessionId,
      kind: overlap.kind,
      score: overlap.score,
      rationale: overlap.rationale,
    })),
  });
}

import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import {
  listCoordinationMessages,
  listPathClaims,
} from "../coordination/agent-coordination";
import { getDatabase } from "../platform/database";
import { publicAttachmentMetadata } from "./agent-turn-context";

export async function listAgentSessions(workspaceId: string) {
  const sessions = await getDatabase()
    .select({
      id: schema.agentSessions.id,
      workspaceId: schema.agentSessions.workspaceId,
      createdBy: schema.agentSessions.createdBy,
      ownerName: schema.users.name,
      ownerLogin: schema.users.login,
      name: schema.agentSessions.name,
      model: schema.agentSessions.model,
      provider: schema.agentSessions.provider,
      status: schema.agentSessions.status,
      worktreeId: schema.agentSessions.worktreeId,
      worktreeName: schema.worktrees.name,
      worktreeStatus: schema.worktrees.status,
      reviewHeadSha: schema.worktrees.reviewHeadSha,
      reviewBaseSha: schema.worktrees.reviewBaseSha,
      reviewDiffDigest: schema.worktrees.reviewDiffDigest,
      reviewedBy: schema.worktrees.reviewedBy,
      reviewedAt: schema.worktrees.reviewedAt,
      mergedAt: schema.worktrees.mergedAt,
      discardedAt: schema.worktrees.discardedAt,
      issueNumber: schema.agentSessions.issueNumber,
      issueTitle: schema.githubIssueAssignments.title,
      issueUrl: schema.githubIssueAssignments.url,
      lastError: schema.agentSessions.lastError,
      createdAt: schema.agentSessions.createdAt,
    })
    .from(schema.agentSessions)
    .innerJoin(
      schema.worktrees,
      eq(schema.agentSessions.worktreeId, schema.worktrees.id),
    )
    .leftJoin(
      schema.githubIssueAssignments,
      eq(schema.agentSessions.id, schema.githubIssueAssignments.sessionId),
    )
    .leftJoin(schema.users, eq(schema.agentSessions.createdBy, schema.users.id))
    // Only managed workflow sessions: `cli` sessions stand in for agent CLIs in
    // the embedded IDE and take part in coordination only, not turns/reviews/
    // workboard, and must not consume a managed parallel-agent slot.
    .where(
      and(
        eq(schema.agentSessions.workspaceId, workspaceId),
        eq(schema.agentSessions.kind, "managed"),
      ),
    )
    .orderBy(asc(schema.agentSessions.createdAt));
  return Promise.all(
    sessions.map(async (session) => {
      const [turns, events, claims, messages] = await Promise.all([
        getDatabase()
          .select({
            id: schema.agentTurns.id,
            authorId: schema.agentTurns.authorId,
            authorName: schema.users.name,
            authorLogin: schema.users.login,
            prompt: schema.agentTurns.prompt,
            attachments: schema.agentTurns.attachments,
            status: schema.agentTurns.status,
            output: schema.agentTurns.output,
            lastError: schema.agentTurns.lastError,
            createdAt: schema.agentTurns.createdAt,
          })
          .from(schema.agentTurns)
          .leftJoin(
            schema.users,
            eq(schema.agentTurns.authorId, schema.users.id),
          )
          .where(eq(schema.agentTurns.sessionId, session.id))
          .orderBy(asc(schema.agentTurns.createdAt)),
        getDatabase()
          .select({
            id: schema.agentEvents.id,
            turnId: schema.agentEvents.turnId,
            type: schema.agentEvents.type,
            payload: schema.agentEvents.payload,
            createdAt: schema.agentEvents.createdAt,
          })
          .from(schema.agentEvents)
          .where(eq(schema.agentEvents.sessionId, session.id))
          .orderBy(desc(schema.agentEvents.createdAt))
          .limit(80),
        listPathClaims(workspaceId, session.id),
        listCoordinationMessages(workspaceId, session.id),
      ]);
      return {
        ...session,
        turns: turns.map((turn) => ({
          ...turn,
          attachments: publicAttachmentMetadata(turn.attachments),
        })),
        events: events.reverse(),
        claims,
        messages,
      };
    }),
  );
}

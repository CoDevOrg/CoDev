import "server-only";

import type { MemberStatusInput, TeamRoster } from "@codev/contracts";
import { schema } from "@codev/db";
import { and, desc, eq, inArray } from "drizzle-orm";

import { listWorkspacePresenceEntries } from "./collaboration-server";
import { getDatabase } from "./database";
import { mergeTeamRoster, type RosterAgentRow } from "./team-chat-view";

/** Sessions in these states are things someone is actively working on. */
const LIVE_AGENT_STATUSES = ["idle", "running", "waiting"] as const;
const TASK_PREVIEW_LENGTH = 120;

function previewTask(value: string | null | undefined, fallback: string) {
  const text = value?.trim().replace(/\s+/g, " ");
  if (!text) return fallback;
  return text.length > TASK_PREVIEW_LENGTH
    ? `${text.slice(0, TASK_PREVIEW_LENGTH - 1)}…`
    : text;
}

async function loadLiveAgents(workspaceId: string): Promise<RosterAgentRow[]> {
  const sessions = await getDatabase()
    .select({
      id: schema.agentSessions.id,
      name: schema.agentSessions.name,
      provider: schema.agentSessions.provider,
      status: schema.agentSessions.status,
      ownerId: schema.agentSessions.createdBy,
      ownerLogin: schema.users.login,
      ownerName: schema.users.name,
    })
    .from(schema.agentSessions)
    .leftJoin(schema.users, eq(schema.users.id, schema.agentSessions.createdBy))
    .where(
      and(
        eq(schema.agentSessions.workspaceId, workspaceId),
        inArray(schema.agentSessions.status, [...LIVE_AGENT_STATUSES]),
      ),
    )
    .orderBy(desc(schema.agentSessions.updatedAt));

  if (sessions.length === 0) return [];

  // One query for the newest prompt in each of these sessions, then matched up
  // in memory: the roster is polled, so a per-session round trip would be the
  // most expensive thing on the page.
  const turns = await getDatabase()
    .selectDistinctOn([schema.agentTurns.sessionId], {
      sessionId: schema.agentTurns.sessionId,
      prompt: schema.agentTurns.prompt,
    })
    .from(schema.agentTurns)
    .where(
      inArray(
        schema.agentTurns.sessionId,
        sessions.map((session) => session.id),
      ),
    )
    .orderBy(
      desc(schema.agentTurns.sessionId),
      desc(schema.agentTurns.createdAt),
    );
  const promptBySession = new Map(
    turns.map((turn) => [turn.sessionId, turn.prompt]),
  );

  return sessions.map((session) => ({
    sessionId: session.id,
    name: session.name,
    provider: session.provider,
    status: session.status,
    currentTask: previewTask(
      promptBySession.get(session.id),
      session.status === "idle" ? "Waiting for a task" : session.name,
    ),
    ownerId: session.ownerId,
    owner: session.ownerName?.trim() || session.ownerLogin || "Unassigned",
  }));
}

export async function getTeamRoster(
  workspaceId: string,
  viewerId: string,
): Promise<TeamRoster> {
  const [members, presence, agents] = await Promise.all([
    getDatabase()
      .select({
        id: schema.users.id,
        login: schema.users.login,
        name: schema.users.name,
        avatarUrl: schema.users.avatarUrl,
        accessRole: schema.workspaceMembers.accessRole,
        headline: schema.workspaceMemberStatuses.headline,
        emoji: schema.workspaceMemberStatuses.emoji,
      })
      .from(schema.workspaceMembers)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.workspaceMembers.userId),
      )
      .leftJoin(
        schema.workspaceMemberStatuses,
        and(
          eq(
            schema.workspaceMemberStatuses.workspaceId,
            schema.workspaceMembers.workspaceId,
          ),
          eq(
            schema.workspaceMemberStatuses.userId,
            schema.workspaceMembers.userId,
          ),
        ),
      )
      .where(eq(schema.workspaceMembers.workspaceId, workspaceId)),
    listWorkspacePresenceEntries(workspaceId),
    loadLiveAgents(workspaceId),
  ]);

  return mergeTeamRoster({
    viewerId,
    members: members.map((member) => ({
      user: {
        id: member.id,
        login: member.login,
        name: member.name,
        avatarUrl: member.avatarUrl,
      },
      accessRole: member.accessRole,
      headline: member.headline,
      emoji: member.emoji,
    })),
    presence: presence.map((entry) => ({
      userId: entry.user.id,
      path: entry.path ?? null,
    })),
    agents,
  });
}

export async function setMemberStatus(
  workspaceId: string,
  userId: string,
  input: MemberStatusInput,
) {
  const headline = input.headline?.trim() || null;
  const emoji = input.emoji?.trim() || null;
  await getDatabase()
    .insert(schema.workspaceMemberStatuses)
    .values({ workspaceId, userId, headline, emoji, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [
        schema.workspaceMemberStatuses.workspaceId,
        schema.workspaceMemberStatuses.userId,
      ],
      set: { headline, emoji, updatedAt: new Date() },
    });
  return { headline, emoji };
}

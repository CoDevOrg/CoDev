import "server-only";

import { pilotCheckpointKeys } from "@codev/contracts";
import { schema } from "@codev/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { getDatabase } from "./database";
import { logEvent } from "./observability";

type PilotCheckpoint = (typeof pilotCheckpointKeys)[number];
type PilotStatus = "running" | "blocked" | "completed";
type BlockerCategory =
  | "access"
  | "collaboration"
  | "agent"
  | "publication"
  | "runtime"
  | "cost"
  | "other";

export const pilotCheckpointLabels: Record<PilotCheckpoint, string> = {
  preflight: "Launch preflight passes",
  secondIdentity: "Second GitHub identity joins",
  realtime: "Realtime presence and editing work",
  terminal: "Authenticated terminal works",
  twoAgents: "Two agent sessions complete turns",
  collision: "A contested path claim is resolved",
  publication: "A codev/* branch is published",
  defaultBranchUnchanged: "Default branch remains unchanged",
  feedback: "Design-partner feedback is submitted",
  teardown: "Sandbox teardown is confirmed",
};

const DAY_MS = 24 * 60 * 60 * 1_000;

export async function getPilotConsoleData() {
  const database = getDatabase();
  const now = Date.now();
  const since7Days = new Date(now - 7 * DAY_MS);
  const since14Days = new Date(now - 14 * DAY_MS);

  const [
    workspaces,
    sessions,
    feedback,
    workspaceActivity,
    turns,
    contestedClaims,
    publications,
    feedbackCount,
  ] = await Promise.all([
    database
      .select({
        id: schema.workspaces.id,
        repository: schema.workspaces.repository,
        status: schema.workspaces.status,
        visibility: schema.workspaces.repositoryVisibility,
        memberCount: sql<number>`count(${schema.workspaceMembers.userId})::int`,
        lastActivityAt: schema.workspaces.lastActivityAt,
      })
      .from(schema.workspaces)
      .leftJoin(
        schema.workspaceMembers,
        eq(schema.workspaceMembers.workspaceId, schema.workspaces.id),
      )
      .groupBy(schema.workspaces.id)
      .orderBy(desc(schema.workspaces.lastActivityAt))
      .limit(100),
    database
      .select({
        id: schema.pilotSessions.id,
        workspaceId: schema.pilotSessions.workspaceId,
        repository: schema.workspaces.repository,
        createdByLogin: schema.users.login,
        status: schema.pilotSessions.status,
        checkpoints: schema.pilotSessions.checkpoints,
        blockerCategory: schema.pilotSessions.blockerCategory,
        release: schema.pilotSessions.release,
        startedAt: schema.pilotSessions.startedAt,
        completedAt: schema.pilotSessions.completedAt,
      })
      .from(schema.pilotSessions)
      .innerJoin(
        schema.workspaces,
        eq(schema.workspaces.id, schema.pilotSessions.workspaceId),
      )
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.pilotSessions.createdBy),
      )
      .orderBy(desc(schema.pilotSessions.startedAt))
      .limit(25),
    database
      .select({
        id: schema.designPartnerFeedback.id,
        authorLogin: schema.users.login,
        repository: schema.workspaces.repository,
        category: schema.designPartnerFeedback.category,
        rating: schema.designPartnerFeedback.rating,
        message: schema.designPartnerFeedback.message,
        page: schema.designPartnerFeedback.page,
        release: schema.designPartnerFeedback.release,
        status: schema.designPartnerFeedback.status,
        createdAt: schema.designPartnerFeedback.createdAt,
      })
      .from(schema.designPartnerFeedback)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.designPartnerFeedback.userId),
      )
      .leftJoin(
        schema.workspaces,
        eq(schema.workspaces.id, schema.designPartnerFeedback.workspaceId),
      )
      .orderBy(desc(schema.designPartnerFeedback.createdAt))
      .limit(25),
    database
      .select({
        workspaceId: schema.workspaceEvents.workspaceId,
        actorId: schema.workspaceEvents.actorId,
        createdAt: schema.workspaceEvents.createdAt,
      })
      .from(schema.workspaceEvents)
      .where(gte(schema.workspaceEvents.createdAt, since14Days))
      .limit(10_000),
    database
      .select({
        sessionId: schema.agentTurns.sessionId,
        authorId: schema.agentTurns.authorId,
      })
      .from(schema.agentTurns)
      .where(gte(schema.agentTurns.createdAt, since7Days))
      .limit(10_000),
    database
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.pathClaims)
      .where(
        and(
          eq(schema.pathClaims.status, "contested"),
          gte(schema.pathClaims.createdAt, since7Days),
        ),
      ),
    database
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.publishedBranches)
      .where(
        and(
          eq(schema.publishedBranches.status, "published"),
          gte(schema.publishedBranches.publishedAt, since7Days),
        ),
      ),
    database
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.designPartnerFeedback)
      .where(gte(schema.designPartnerFeedback.createdAt, since7Days)),
  ]);

  const actorsByWorkspace = new Map<string, Set<string>>();
  const currentActors = new Set<string>();
  const previousActors = new Set<string>();
  for (const event of workspaceActivity) {
    if (!event.actorId) continue;
    if (event.createdAt >= since7Days) {
      currentActors.add(event.actorId);
      const actors = actorsByWorkspace.get(event.workspaceId) ?? new Set();
      actors.add(event.actorId);
      actorsByWorkspace.set(event.workspaceId, actors);
    } else {
      previousActors.add(event.actorId);
    }
  }

  const authorsBySession = new Map<string, Set<string>>();
  for (const turn of turns) {
    const authors = authorsBySession.get(turn.sessionId) ?? new Set();
    authors.add(turn.authorId);
    authorsBySession.set(turn.sessionId, authors);
  }
  const coSteeredSessions = [...authorsBySession.values()].filter(
    (authors) => authors.size >= 2,
  ).length;
  const returningUsers = [...currentActors].filter((actorId) =>
    previousActors.has(actorId),
  ).length;

  return {
    checkpoints: pilotCheckpointKeys.map((key) => ({
      key,
      label: pilotCheckpointLabels[key],
    })),
    metrics: {
      activeUsers7d: currentActors.size,
      returningUsers7d: returningUsers,
      sharedWorkspaces7d: [...actorsByWorkspace.values()].filter(
        (actors) => actors.size >= 2,
      ).length,
      coSteeringRate:
        authorsBySession.size === 0
          ? 0
          : Math.round((coSteeredSessions / authorsBySession.size) * 100),
      contestedClaims7d: contestedClaims[0]?.count ?? 0,
      publications7d: publications[0]?.count ?? 0,
      feedback7d: feedbackCount[0]?.count ?? 0,
    },
    workspaces,
    sessions,
    feedback,
  };
}

export async function createPilotSession(input: {
  workspaceId: string;
  userId: string;
}) {
  const database = getDatabase();
  const [workspace] = await database
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, input.workspaceId))
    .limit(1);
  if (!workspace) throw new Error("Workspace not found.");

  const [active] = await database
    .select({ id: schema.pilotSessions.id })
    .from(schema.pilotSessions)
    .where(
      and(
        eq(schema.pilotSessions.workspaceId, input.workspaceId),
        inArray(schema.pilotSessions.status, ["running", "blocked"]),
      ),
    )
    .limit(1);
  if (active) throw new Error("This workspace already has an active pilot.");

  const checkpoints = Object.fromEntries(
    pilotCheckpointKeys.map((key) => [key, false]),
  );
  const [session] = await database
    .insert(schema.pilotSessions)
    .values({
      workspaceId: input.workspaceId,
      createdBy: input.userId,
      checkpoints,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? "development",
    })
    .returning({ id: schema.pilotSessions.id });
  if (!session) throw new Error("Pilot session could not be created.");

  logEvent("info", "pilot.session_created", {
    pilotSessionId: session.id,
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  return session;
}

export async function updatePilotSession(input: {
  sessionId: string;
  userId: string;
  checkpoint?: PilotCheckpoint | undefined;
  checked?: boolean | undefined;
  status?: PilotStatus | undefined;
  blockerCategory?: BlockerCategory | null | undefined;
}) {
  const database = getDatabase();
  const [existing] = await database
    .select({
      status: schema.pilotSessions.status,
      checkpoints: schema.pilotSessions.checkpoints,
      blockerCategory: schema.pilotSessions.blockerCategory,
    })
    .from(schema.pilotSessions)
    .where(eq(schema.pilotSessions.id, input.sessionId))
    .limit(1);
  if (!existing) throw new Error("Pilot session not found.");

  const checkpoints = { ...existing.checkpoints };
  if (input.checkpoint !== undefined && input.checked !== undefined) {
    checkpoints[input.checkpoint] = input.checked;
  }
  const status = input.status ?? existing.status;
  const blockerCategory =
    input.blockerCategory !== undefined
      ? input.blockerCategory
      : existing.blockerCategory;
  if (status === "blocked" && !blockerCategory) {
    throw new Error("Choose a blocker category before blocking a pilot.");
  }
  if (
    status === "completed" &&
    !pilotCheckpointKeys.every((key) => checkpoints[key] === true)
  ) {
    throw new Error("Complete every checkpoint before finishing the pilot.");
  }

  const [session] = await database
    .update(schema.pilotSessions)
    .set({
      checkpoints,
      status,
      blockerCategory: status === "completed" ? null : blockerCategory,
      completedAt: status === "completed" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.pilotSessions.id, input.sessionId))
    .returning({ id: schema.pilotSessions.id });
  if (!session) throw new Error("Pilot session could not be updated.");

  logEvent("info", "pilot.session_updated", {
    pilotSessionId: input.sessionId,
    userId: input.userId,
    status,
    checkpoint: input.checkpoint,
    checked: input.checked,
    blockerCategory,
  });
  return session;
}

export async function updatePilotFeedback(input: {
  feedbackId: string;
  userId: string;
  status: "new" | "reviewing" | "planned" | "resolved";
}) {
  const [feedback] = await getDatabase()
    .update(schema.designPartnerFeedback)
    .set({ status: input.status, updatedAt: new Date() })
    .where(eq(schema.designPartnerFeedback.id, input.feedbackId))
    .returning({ id: schema.designPartnerFeedback.id });
  if (!feedback) throw new Error("Feedback not found.");

  logEvent("info", "pilot.feedback_triaged", {
    feedbackId: input.feedbackId,
    userId: input.userId,
    status: input.status,
  });
  return feedback;
}

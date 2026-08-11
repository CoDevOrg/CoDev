import { randomUUID } from "node:crypto";

import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@codev/db";
import { MAX_PARALLEL_AGENT_SESSIONS } from "@codev/contracts";

import { kickAgentSession } from "@/lib/agent-service";
import {
  branchWorktreeName,
  deriveBranchSessionName,
  selectTurnsThroughReply,
} from "@/lib/agent-branch";
import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import {
  createSandboxWorktree,
  checkpointSandboxWorktree,
  deleteSandboxWorktree,
} from "@/lib/orchestrator";
import { getDatabase } from "@/lib/database";
import {
  getWorkspaceForMember,
  WorkspaceLifecycleError,
} from "@/lib/workspaces";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";

const branchSchema = z.object({
  name: z.string().trim().min(1).max(32).optional(),
  prompt: z.string().trim().min(1).max(20_000).optional(),
  fromTurnId: z.string().uuid(),
});

class AgentCapacityError extends Error {}

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ workspaceId: string; sessionId: string }>;
  },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId, sessionId } = await params;

  let workspace;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "coSteer");
    workspace = await getWorkspaceForMember(workspaceId, user.id);
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }
  if (!workspace) return apiError(new Error("Workspace not found."), 404);
  if (!workspace.repository || workspace.githubRepositoryId === null) {
    return apiError(
      new Error("Connect a GitHub repository before branching an agent."),
      409,
    );
  }

  try {
    const input = branchSchema.parse(await request.json());
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);

    const [source] = await getDatabase()
      .select({
        id: schema.agentSessions.id,
        name: schema.agentSessions.name,
        model: schema.agentSessions.model,
        provider: schema.agentSessions.provider,
        worktreeId: schema.worktrees.id,
        headSha: schema.worktrees.headSha,
        worktreeStatus: schema.worktrees.status,
      })
      .from(schema.agentSessions)
      .innerJoin(
        schema.worktrees,
        eq(schema.agentSessions.worktreeId, schema.worktrees.id),
      )
      .where(
        and(
          eq(schema.agentSessions.id, sessionId),
          eq(schema.agentSessions.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    if (!source) return apiError(new Error("Agent session not found."), 404);

    const sourceTurns = await getDatabase()
      .select({
        id: schema.agentTurns.id,
        prompt: schema.agentTurns.prompt,
        attachments: schema.agentTurns.attachments,
        status: schema.agentTurns.status,
        output: schema.agentTurns.output,
        lastError: schema.agentTurns.lastError,
        responseId: schema.agentTurns.responseId,
        createdAt: schema.agentTurns.createdAt,
      })
      .from(schema.agentTurns)
      .where(eq(schema.agentTurns.sessionId, sessionId))
      .orderBy(asc(schema.agentTurns.createdAt));

    const turnsToCopy = selectTurnsThroughReply(sourceTurns, input.fromTurnId);
    const branchPoint = turnsToCopy.at(-1);
    if (
      !branchPoint ||
      (branchPoint.status !== "completed" && !branchPoint.output)
    ) {
      return apiError(new Error("Branch from a completed agent reply."), 409);
    }

    let headSha = source.headSha;
    if (
      source.worktreeStatus === "active" ||
      source.worktreeStatus === "frozen"
    ) {
      try {
        const checkpoint = await checkpointSandboxWorktree(
          workspaceId,
          source.worktreeId,
          source.headSha,
        );
        headSha = checkpoint.headSha;
        await getDatabase()
          .update(schema.worktrees)
          .set({ headSha, updatedAt: new Date() })
          .where(eq(schema.worktrees.id, source.worktreeId));
      } catch {
        // Fall back to the last known source SHA if checkpointing is unavailable.
      }
    }

    const sessionName =
      input.name?.trim() || deriveBranchSessionName(source.name);

    const reservation = await getDatabase().transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`agent-slot:${workspaceId}`}))`,
      );
      const [workspaceState] = await transaction
        .select({ status: schema.workspaces.status })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, workspaceId))
        .limit(1)
        .for("update");
      if (workspaceState?.status !== "ready") {
        throw new WorkspaceLifecycleError(
          "The workspace is not ready for a new agent. Try again after it resumes.",
        );
      }
      const [sessionCount] = await transaction
        .select({ value: count() })
        .from(schema.agentSessions)
        .innerJoin(
          schema.worktrees,
          eq(schema.agentSessions.worktreeId, schema.worktrees.id),
        )
        .where(
          and(
            eq(schema.agentSessions.workspaceId, workspaceId),
            inArray(schema.worktrees.status, ["active", "frozen"]),
          ),
        );
      if (Number(sessionCount?.value ?? 0) >= MAX_PARALLEL_AGENT_SESSIONS) {
        throw new AgentCapacityError(
          `A workspace supports at most ${MAX_PARALLEL_AGENT_SESSIONS} agent sessions.`,
        );
      }

      const [worktree] = await transaction
        .insert(schema.worktrees)
        .values({
          workspaceId,
          kind: "agent",
          name: branchWorktreeName(sessionName, randomUUID().slice(0, 8)),
          headSha,
        })
        .returning({ id: schema.worktrees.id });
      if (!worktree) throw new Error("Could not reserve a branched worktree.");

      const [session] = await transaction
        .insert(schema.agentSessions)
        .values({
          workspaceId,
          worktreeId: worktree.id,
          createdBy: user.id,
          name: sessionName,
          model: source.model,
          provider: source.provider,
          status: "idle",
        })
        .returning({ id: schema.agentSessions.id });
      if (!session) throw new Error("Could not create the branched session.");

      const now = new Date();
      for (const turn of turnsToCopy) {
        await transaction.insert(schema.agentTurns).values({
          sessionId: session.id,
          authorId: user.id,
          prompt: turn.prompt,
          attachments: turn.attachments ?? [],
          status: "completed",
          responseId: turn.responseId,
          output: turn.output,
          lastError: turn.lastError,
          startedAt: turn.createdAt ?? now,
          finishedAt: now,
          createdAt: turn.createdAt ?? now,
          updatedAt: now,
        });
      }

      if (input.prompt) {
        await transaction.insert(schema.agentTurns).values({
          sessionId: session.id,
          authorId: user.id,
          prompt: input.prompt,
          attachments: [],
        });
      }

      const shortId = worktree.id.slice(0, 8);
      const slug = sessionName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 20);
      const branchName = `agent/${slug || "branch"}-${shortId}`;

      return {
        headSha,
        sessionId: session.id,
        worktreeId: worktree.id,
        branchName,
        kick: Boolean(input.prompt),
      };
    });

    try {
      await createSandboxWorktree(
        workspaceId,
        reservation.worktreeId,
        reservation.headSha,
        reservation.branchName,
      );
      if (reservation.kick) {
        await kickAgentSession(reservation.sessionId);
      }
      return Response.json(
        { sessionId: reservation.sessionId },
        { status: 201 },
      );
    } catch (error) {
      await deleteSandboxWorktree(workspaceId, reservation.worktreeId).catch(
        () => undefined,
      );
      await getDatabase()
        .delete(schema.worktrees)
        .where(eq(schema.worktrees.id, reservation.worktreeId));
      throw error;
    }
  } catch (error) {
    return apiError(
      error,
      error instanceof AgentCapacityError ||
        error instanceof WorkspaceLifecycleError
        ? 409
        : 400,
    );
  }
}

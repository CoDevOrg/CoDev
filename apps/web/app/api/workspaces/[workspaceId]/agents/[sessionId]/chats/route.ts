import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@codev/db";

import { kickAgentSession } from "@/lib/agent-service";
import {
  canStartFreshChat,
  deriveFreshChatSessionName,
} from "@/lib/agent-fresh-chat";
import { apiError, getApiUserAnyAuth } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { getDatabase } from "@/lib/database";
import { getWorkspaceForMember } from "@/lib/workspaces";

/**
 * Start a fresh chat on an agent that is already running.
 *
 * Unlike `POST /agents` (a new agent, a new worktree, a capacity slot) and
 * `POST /agents/:id/branch` (a new worktree forked at a chosen reply), this
 * reuses the source session's worktree exactly as it stands. The member keeps
 * the branch and the files, and gets an empty context to talk into. No
 * checkout is created, so no slot is consumed.
 */
const freshChatSchema = z.object({
  name: z.string().trim().min(1).max(32).optional(),
  prompt: z.string().trim().min(1).max(20_000).optional(),
});

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ workspaceId: string; sessionId: string }>;
  },
) {
  const user = await getApiUserAnyAuth(request);
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

  try {
    const input = freshChatSchema.parse(await request.json());

    const [source] = await getDatabase()
      .select({
        name: schema.agentSessions.name,
        model: schema.agentSessions.model,
        provider: schema.agentSessions.provider,
        worktreeId: schema.worktrees.id,
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
    if (!canStartFreshChat(source.worktreeStatus)) {
      return apiError(
        new Error(
          "This agent's worktree is no longer live. Start a new agent instead.",
        ),
        409,
      );
    }

    const siblings = await getDatabase()
      .select({ name: schema.agentSessions.name })
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.worktreeId, source.worktreeId));

    const sessionName =
      input.name ??
      deriveFreshChatSessionName(
        source.name,
        siblings.map((sibling) => sibling.name),
      );

    const created = await getDatabase().transaction(async (transaction) => {
      const [session] = await transaction
        .insert(schema.agentSessions)
        .values({
          workspaceId,
          worktreeId: source.worktreeId,
          createdBy: user.id,
          name: sessionName,
          model: source.model,
          provider: source.provider,
          status: "idle",
        })
        .returning({ id: schema.agentSessions.id });
      if (!session) throw new Error("Could not start a new chat.");

      if (input.prompt) {
        await transaction.insert(schema.agentTurns).values({
          sessionId: session.id,
          authorId: user.id,
          prompt: input.prompt,
          attachments: [],
        });
      }

      return { sessionId: session.id, kick: Boolean(input.prompt) };
    });

    // The worktree is already checked out on the runtime, so unlike the create
    // and branch paths there is nothing to provision before the agent can run.
    if (created.kick) {
      await kickAgentSession(created.sessionId);
    }

    return Response.json(
      { sessionId: created.sessionId, worktreeId: source.worktreeId },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error, 400);
  }
}

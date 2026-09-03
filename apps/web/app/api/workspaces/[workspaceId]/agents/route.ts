import { randomUUID } from "node:crypto";

import { and, countDistinct, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@codev/db";
import { MAX_PARALLEL_AGENT_SESSIONS } from "@codev/contracts";
import { kickAgentSession } from "@/lib/agent-service";
import { listAgentSessions } from "@/lib/agent-runtime";
import { apiError, getApiUserAnyAuth } from "@/lib/api";
import {
  getAgentProvider,
  getSelectableAgentModels,
  parseAgentProvider,
  resolveSelectableAgentModel,
} from "@/lib/ai-model";
import { requireWorkspacePermission } from "@/lib/access";
import { resolveAgentCredential } from "@/lib/credentials";
import { getDatabase } from "@/lib/database";
import { getGitHubUserToken } from "@/lib/github";
import {
  createSandboxWorktree,
  deleteSandboxWorktree,
} from "@/lib/orchestrator";
import {
  getWorkspaceForMember,
  WorkspaceLifecycleError,
} from "@/lib/workspaces";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";
import { readWorkspaceStateEvents } from "@/lib/workspace-state";
import {
  AgentCapacityError,
  assertAgentCapacity,
  summarizeAgentCapacity,
} from "@/lib/agent-capacity";
import {
  agentAttachmentsSchema,
  toStoredAgentAttachments,
} from "@/lib/agent-attachments";
import {
  AgentPromptRateLimitError,
  enforceAgentPromptRateLimit,
} from "@/lib/agent-rate-limit";

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(32),
    prompt: z.string().trim().min(1).max(20_000).optional(),
    draft: z.literal(true).optional(),
    model: z.string().trim().min(1).max(120).optional(),
    provider: z
      .enum(["openai", "anthropic", "cursor", "bedrock", "azure_foundry"])
      .optional(),
    issueNumber: z.number().int().positive().optional(),
    attachments: agentAttachmentsSchema,
  })
  .superRefine((input, context) => {
    if (!input.draft && !input.prompt) {
      context.addIssue({
        code: "custom",
        path: ["prompt"],
        message: "A prompt is required unless creating a managed proposal.",
      });
    }
  });

class DuplicateIssueError extends Error {}
function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

async function getExactGitHubIssue(
  userId: string,
  repository: string,
  issueNumber: number,
) {
  const token = await getGitHubUserToken(userId);
  const response = await fetch(
    `https://api.github.com/repos/${repository}/issues/${issueNumber}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "CoDev",
      },
      cache: "no-store",
    },
  );
  if (response.status === 404) {
    throw new Error("GitHub issue not found in this workspace repository.");
  }
  if (!response.ok) {
    throw new Error(
      `GitHub issue lookup failed with status ${response.status}.`,
    );
  }
  const issue = z
    .object({
      id: z.number().int().positive(),
      number: z.number().int().positive(),
      title: z.string().min(1).max(1_000),
      html_url: z.url(),
      pull_request: z.unknown().optional(),
    })
    .parse(await response.json());
  if (issue.pull_request || issue.number !== issueNumber) {
    throw new Error("The selected number is not an exact GitHub issue.");
  }
  return issue;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUserAnyAuth(request);
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "view");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }
  const [sessions, stateEvents] = await Promise.all([
    listAgentSessions(workspaceId),
    readWorkspaceStateEvents(workspaceId),
  ]);
  const capacity = summarizeAgentCapacity(sessions);
  const includeModels =
    new URL(request.url).searchParams.get("includeModels") === "true";
  const requestedProvider = new URL(request.url).searchParams.get("provider");
  const models = includeModels
    ? await (async () => {
        const provider = parseAgentProvider(
          requestedProvider ?? undefined,
          getAgentProvider(),
        );
        const credential = await resolveAgentCredential(
          user.id,
          workspaceId,
          provider,
        ).catch(() => undefined);
        return getSelectableAgentModels(provider, credential);
      })()
    : undefined;
  return Response.json({
    sessions,
    stateEvents,
    capacity,
    ...(models ? { models } : {}),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUserAnyAuth(request);
  if (!user) return apiError(new Error("Authentication required."), 401);
  const { workspaceId } = await params;
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
    const input = createSchema.parse(await request.json());
    if (
      !input.draft &&
      (!workspace.repository || workspace.githubRepositoryId === null)
    ) {
      return apiError(
        new Error("Connect a GitHub repository before creating an agent."),
        409,
      );
    }
    const provider = parseAgentProvider(input.provider, getAgentProvider());
    const credential = input.draft
      ? undefined
      : await resolveAgentCredential(user.id, workspaceId, provider);
    const model = await resolveSelectableAgentModel(
      input.model,
      provider,
      credential,
    );
    if (!input.draft) {
      await enforceAgentPromptRateLimit(user.id, workspaceId, provider);
    }
    const provisionSandboxWorktree =
      Boolean(workspace.repository && workspace.githubRepositoryId) ||
      !input.draft;
    if (provisionSandboxWorktree) {
      await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    }
    const issue =
      input.issueNumber && workspace.repository
        ? await getExactGitHubIssue(
            user.id,
            workspace.repository,
            input.issueNumber,
          )
        : null;
    let reservation;
    try {
      reservation = await getDatabase().transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`agent-slot:${workspaceId}`}))`,
        );
        const [workspaceState] = await transaction
          .select({ status: schema.workspaces.status })
          .from(schema.workspaces)
          .where(eq(schema.workspaces.id, workspaceId))
          .limit(1)
          .for("update");
        if (
          workspaceState?.status !== "ready" &&
          !(input.draft && !workspace.githubRepositoryId)
        ) {
          throw new WorkspaceLifecycleError(
            "The workspace is not ready for a new agent. Try again after it resumes.",
          );
        }
        // A slot is a worktree, not a conversation. Several chat threads can
        // share one worktree (a member starting a fresh context on the same
        // branch), and those cost no extra checkout or running process, so
        // they must not consume capacity.
        const [worktreeCount] = await transaction
          .select({ value: countDistinct(schema.worktrees.id) })
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
        assertAgentCapacity(Number(worktreeCount?.value ?? 0));
        const [repository] = await transaction
          .select({ id: schema.workspaces.githubRepositoryId })
          .from(schema.workspaces)
          .where(eq(schema.workspaces.id, workspaceId))
          .limit(1);
        const githubRepositoryId = repository?.id ?? null;
        if (issue) {
          if (githubRepositoryId === null) {
            throw new Error("Workspace repository not found.");
          }
          const [existingAssignment] = await transaction
            .select({ id: schema.githubIssueAssignments.id })
            .from(schema.githubIssueAssignments)
            .where(
              and(
                eq(
                  schema.githubIssueAssignments.githubRepositoryId,
                  githubRepositoryId,
                ),
                eq(schema.githubIssueAssignments.issueNumber, issue.number),
              ),
            )
            .limit(1);
          if (existingAssignment) {
            throw new DuplicateIssueError(
              "This exact GitHub issue already has an agent session.",
            );
          }
        }
        const [integration] = await transaction
          .select({ headSha: schema.worktrees.headSha })
          .from(schema.worktrees)
          .where(
            and(
              eq(schema.worktrees.workspaceId, workspaceId),
              eq(schema.worktrees.kind, "integration"),
            ),
          )
          .limit(1);
        if (!integration) throw new Error("Integration worktree not found.");
        const [worktree] = await transaction
          .insert(schema.worktrees)
          .values({
            workspaceId,
            kind: "agent",
            name: `agent-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 8)}`,
            headSha: integration.headSha,
          })
          .returning({ id: schema.worktrees.id });
        if (!worktree) throw new Error("Could not reserve an agent worktree.");
        const [session] = await transaction
          .insert(schema.agentSessions)
          .values({
            workspaceId,
            worktreeId: worktree.id,
            createdBy: user.id,
            issueNumber: issue?.number,
            name: input.name,
            model,
            provider,
          })
          .returning({ id: schema.agentSessions.id });
        if (!session) throw new Error("Could not create the agent session.");
        if (issue) {
          if (githubRepositoryId === null) {
            throw new Error("Workspace repository not found.");
          }
          await transaction.insert(schema.githubIssueAssignments).values({
            workspaceId,
            sessionId: session.id,
            githubRepositoryId,
            issueNumber: issue.number,
            githubIssueId: BigInt(issue.id),
            title: issue.title,
            url: issue.html_url,
          });
        }
        if (!input.draft) {
          await transaction.insert(schema.agentTurns).values({
            sessionId: session.id,
            authorId: user.id,
            prompt: input.prompt!,
            attachments: toStoredAgentAttachments(input.attachments),
          });
        }
        const shortId = worktree.id.slice(0, 8);
        const slug = input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 20);
        const branchName = `agent/${slug || "session"}-${shortId}`;
        return {
          headSha: integration.headSha,
          sessionId: session.id,
          worktreeId: worktree.id,
          branchName,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateIssueError(
          "This exact GitHub issue already has an agent session.",
        );
      }
      throw error;
    }

    try {
      if (provisionSandboxWorktree) {
        await createSandboxWorktree(
          workspaceId,
          reservation.worktreeId,
          reservation.headSha,
          reservation.branchName,
        );
      }
      if (!input.draft) {
        await kickAgentSession(reservation.sessionId);
      }
      return Response.json(
        {
          sessionId: reservation.sessionId,
          worktreeId: reservation.worktreeId,
        },
        { status: 201 },
      );
    } catch (error) {
      await deleteSandboxWorktree(workspaceId, reservation.worktreeId).catch(
        () => undefined,
      );
      await getDatabase()
        .delete(schema.worktrees)
        .where(eq(schema.worktrees.id, reservation.worktreeId));
      if (isUniqueViolation(error)) {
        throw new DuplicateIssueError(
          "This exact GitHub issue already has an agent session.",
        );
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof AgentPromptRateLimitError) {
      return Response.json(
        { error: error.message, code: "agent_prompt_rate_limit" },
        {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        },
      );
    }
    if (error instanceof AgentCapacityError) {
      return Response.json(
        {
          error: error.message,
          code: "agent_capacity_exceeded",
          maxActiveSessions: MAX_PARALLEL_AGENT_SESSIONS,
        },
        { status: 409 },
      );
    }
    return apiError(error, error instanceof DuplicateIssueError ? 409 : 400);
  }
}

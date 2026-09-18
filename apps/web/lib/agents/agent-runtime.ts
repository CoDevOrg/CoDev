import "server-only";

import { generateText, stepCountIs } from "ai";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getStepMetadata } from "workflow";

import { schema } from "@codev/db";

import { codexFinalMessage } from "../chat/shared-chat-context";
import {
  buildAgentBriefing,
  recordBrainEntry,
  safeDetectOverlaps,
  type OverlapAdjudicator,
} from "../coordination/workspace-brain";
import { createModelOverlapAdjudicator } from "../coordination/workspace-brain-adjudicator";
import { getDatabase } from "../platform/database";
import { notifyWorkspaceMembers } from "../platform/mobile-push";
import {
  createAgentModel,
  getAgentModel,
  parseAgentProvider,
} from "../providers/ai-model";
import {
  claimHostedCodexExecution,
  releaseHostedCodexExecution,
  updateHostedCodexAuthCache,
} from "../providers/hosted-codex-subscription-credentials";
import {
  ProviderConnectionRequiredError,
  assertProviderConnectionForTurn,
} from "../providers/provider-turn-auth";
import {
  closeCodexExecInSandbox,
  pollCodexExecInSandbox,
  startCodexExecInSandbox,
} from "../runtime/orchestrator";
import { lockAgentSession } from "./agent-session-lock";
import { createAgentTools } from "./agent-tool-execution";
import {
  addEvent,
  loadAgentContext,
  modelInput,
  turnWasInterrupted,
  type AgentContext,
} from "./agent-turn-context";
import {
  requireCursorApiKey,
  runCursorCloudAgent,
} from "./cursor-agent-runtime";
import { normalizeTokenUsage } from "./token-usage";

export { validateAgentCommand } from "./agent-tool-execution";
export { turnWasInterrupted } from "./agent-turn-context";
export { listAgentSessions } from "./agent-session-list";

const MAX_TOOL_ROUNDS = 12;

type PrepareAgentTurnResult =
  | { kind: "done" }
  | {
      kind: "codexPending";
      workspaceId: string;
      codexSessionId: string;
      turnId: string;
      credentialId: string;
    };

export async function claimNextAgentTurn(sessionId: string) {
  "use step";

  const result = await getDatabase().transaction(async (transaction) => {
    await lockAgentSession(transaction, sessionId);
    const [session] = await transaction
      .select({
        status: schema.agentSessions.status,
        workspaceId: schema.agentSessions.workspaceId,
      })
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.id, sessionId))
      .limit(1);
    if (!session || session.status !== "running") {
      return { turnId: null, idleWorkspaceId: null };
    }

    const [alreadyRunning] = await transaction
      .select({ id: schema.agentTurns.id })
      .from(schema.agentTurns)
      .where(
        and(
          eq(schema.agentTurns.sessionId, sessionId),
          eq(schema.agentTurns.status, "running"),
        ),
      )
      .limit(1);
    if (alreadyRunning) {
      return { turnId: null, idleWorkspaceId: null };
    }

    const [turn] = await transaction
      .select({ id: schema.agentTurns.id })
      .from(schema.agentTurns)
      .where(
        and(
          eq(schema.agentTurns.sessionId, sessionId),
          eq(schema.agentTurns.status, "queued"),
        ),
      )
      .orderBy(asc(schema.agentTurns.createdAt), asc(schema.agentTurns.id))
      .limit(1);
    if (!turn) {
      await transaction
        .update(schema.agentSessions)
        .set({ status: "idle", workflowRunId: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.agentSessions.id, sessionId),
            eq(schema.agentSessions.status, "running"),
          ),
        );
      return { turnId: null, idleWorkspaceId: session.workspaceId };
    }

    const now = new Date();
    const [claimed] = await transaction
      .update(schema.agentTurns)
      .set({ status: "running", startedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.agentTurns.id, turn.id),
          eq(schema.agentTurns.status, "queued"),
        ),
      )
      .returning({ id: schema.agentTurns.id });
    return { turnId: claimed?.id ?? null, idleWorkspaceId: null };
  });

  if (result.idleWorkspaceId) {
    await notifyWorkspaceMembers(result.idleWorkspaceId, sessionId, "idle");
  }
  return result.turnId;
}

/**
 * Runs a turn up through the point where it either finishes synchronously
 * (Cursor, the plain AI SDK path) or, for a hosted Codex subscription turn,
 * starts the exec and hands back a session to poll — the poll loop itself
 * lives at the "use workflow" level (see workflows/agent-session.ts) so a
 * crash mid-turn resumes by reattaching to the still-running guest-side
 * session instead of this whole step re-running from the top and restarting
 * Codex from scratch.
 */
export async function prepareAgentTurn(
  turnId: string,
): Promise<PrepareAgentTurnResult> {
  "use step";

  const context = await loadAgentContext(turnId);
  const provider = parseAgentProvider(context.provider);
  let credential;
  try {
    credential = await assertProviderConnectionForTurn(
      context.authorId,
      context.workspaceId,
      provider,
    );
  } catch (error) {
    if (error instanceof ProviderConnectionRequiredError) {
      await failCurrentTurnKeepSession(
        turnId,
        context.sessionId,
        error.message,
      );
      return { kind: "done" };
    }
    throw error;
  }

  const history = await getDatabase()
    .select({
      prompt: schema.agentTurns.prompt,
      output: schema.agentTurns.output,
    })
    .from(schema.agentTurns)
    .where(
      and(
        eq(schema.agentTurns.sessionId, context.sessionId),
        inArray(schema.agentTurns.status, ["completed", "running"]),
      ),
    )
    .orderBy(asc(schema.agentTurns.createdAt));
  const transcriptBody = history
    .map(
      (turn) =>
        `User request:\n${turn.prompt}\n\nAgent result:\n${turn.output ?? "(in progress)"}`,
    )
    .join("\n\n---\n\n");

  // The workspace brain's always-on context: what other agents in this
  // workspace are doing, any overlap it has flagged for this session, and
  // relevant history. Advisory only — a failure here must not stop the turn.
  const briefing = await buildAgentBriefing(
    context.workspaceId,
    context.sessionId,
    context.prompt,
  ).catch(() => null);
  const transcript = briefing
    ? `${briefing.text}\n\n---\n\n${transcriptBody}`
    : transcriptBody;
  if (briefing) {
    await addEvent(context, `${turnId}:brain-briefing`, "brain.briefing", {
      otherAgents: briefing.otherAgents,
      overlaps: briefing.overlaps,
      priorAttempts: briefing.priorAttempts,
    });
  }

  await addEvent(context, `${turnId}:started`, "turn.started", {
    prompt: context.prompt,
    model: context.model,
    provider,
  });

  if (await turnWasInterrupted(turnId)) return { kind: "done" };

  if (provider === "cursor") {
    if (!context.repository) {
      throw new Error(
        "Connect a GitHub repository before starting a Cursor agent.",
      );
    }
    let cursorUsage = undefined as
      | {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        }
      | undefined;
    const result = await runCursorCloudAgent({
      apiKey: requireCursorApiKey(credential),
      model: context.model || getAgentModel("cursor"),
      repository: context.repository,
      startingRef: context.baseSha,
      prompt: `Repository session transcript:\n${transcript}\n\nComplete the latest request.`,
      onEvent: async (event) => {
        if (event.kind === "text") {
          await addEvent(
            context,
            `${turnId}:output:${Date.now()}`,
            "agent.output",
            {
              text: event.text,
            },
          );
        } else if (event.kind === "tool") {
          await addEvent(
            context,
            `${turnId}:tool:${event.name}:${Date.now()}`,
            "tool.completed",
            { name: event.name },
          );
        } else if (event.kind === "usage") {
          cursorUsage = event.usage;
        } else {
          await addEvent(
            context,
            `${turnId}:status:${Date.now()}`,
            "agent.output",
            { text: event.text },
          );
        }
      },
    });
    if (await turnWasInterrupted(turnId)) return { kind: "done" };
    cursorUsage = normalizeTokenUsage(result.usage) ?? cursorUsage;
    await getDatabase()
      .update(schema.agentTurns)
      .set({
        status: "completed",
        responseId: result.agentId,
        output: result.output,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.agentTurns.id, turnId));
    await addEvent(context, `${turnId}:output:final`, "agent.output", {
      text: result.output,
      ...(cursorUsage ? { usage: cursorUsage } : {}),
    });
    await addEvent(context, `${turnId}:completed`, "turn.completed", {
      output: result.output,
      ...(cursorUsage ? { usage: cursorUsage } : {}),
    });
    await recordTurnOutcomeInBrain(context, result.output);
    return { kind: "done" };
  }

  if (credential.authType === "HOSTED_CODEX_SUBSCRIPTION") {
    if (!credential.codexAuthCacheJson || !credential.credentialId) {
      throw new Error(
        "Reconnect Codex with `codev codex-auth` before starting a turn.",
      );
    }
    const prompt = `You are a coding agent inside an isolated Git worktree. Complete the latest request, verify focused changes, and finish with a concise summary. Do not inspect CODEX_HOME or authentication files.\n\nRepository session transcript:\n${transcript}\n\nComplete the latest request.`;
    await claimHostedCodexExecution(credential.credentialId);
    const { stepId } = getStepMetadata();
    let codexSessionId: string;
    try {
      codexSessionId = await startCodexExecInSandbox(context.workspaceId, {
        command: [
          "codex",
          "exec",
          "--json",
          "--ephemeral",
          "--ignore-user-config",
          "--sandbox",
          "workspace-write",
          "-c",
          'approval_policy="never"',
          "--model",
          context.model || getAgentModel("openai"),
          "--cd",
          ".",
          prompt,
        ],
        worktreeId: context.worktreeId,
        codexAuthCacheJson: credential.codexAuthCacheJson,
        // A retried "use step" call re-runs this whole function from the
        // top with the same stepId — passing it through lets the guest
        // reattach to the still-running session instead of double-spawning
        // Codex.
        idempotencyKey: stepId,
      });
    } catch (error) {
      await releaseHostedCodexExecution(credential.credentialId);
      throw error;
    }
    return {
      kind: "codexPending",
      workspaceId: context.workspaceId,
      codexSessionId,
      turnId,
      credentialId: credential.credentialId,
    };
  }

  // The official Claude model bridge leases each private CLI invocation;
  // CoDev retains ownership of the validated workspace-tool loop.
  {
    const model = createAgentModel(
      credential,
      context.model || getAgentModel(provider),
    );

    let finalOutput = "";
    const response = await generateText({
      model,
      maxRetries: credential.authType === "CLAUDE_RUNTIME" ? 0 : 2,
      maxOutputTokens: 4096,
      stopWhen: stepCountIs(MAX_TOOL_ROUNDS),
      system:
        "You are a coding agent inside an isolated Git worktree. Deliver the requested repository change, verify it with focused commands, and finish with a concise outcome. Always conclude your response with a clear textual summary explaining what was accomplished or checked. This workspace has a shared brain across every agent: the turn transcript may begin with a 'Workspace Brain briefing' describing what other agents are doing and any overlap flagged for you. Before you plan, call brain_search with what you are about to do; right after you plan, call brain_update_brief with your goal, plan and the files you expect to touch, and keep currentStep and status fresh as you work. If the brain reports another agent doing the same work, coordinate (request_claim_coordination or post_team_chat) or narrow your scope rather than proceeding in parallel — it is a warning, not a block. When an approach fails, call brain_record with kind dead_end so no one retries it. Inspect workspace claims and coordination messages before editing. Before each write, claim the exact file at its read revision or claim a directory/** scope. If another agent overlaps, create a contested claim and negotiate through correlated claim requests and responses instead of overwriting. Release claims when work is complete. Use only the provided tools. Prefer find and grep instead of rg because optional utilities may be absent from the guest image. A nonzero command exit code is diagnostic output; continue when it is safe to do so. You may run any Git commands inside this worktree (e.g. status, pull, push, commit, etc.). For GitHub remote sync or publishing to a codev/* branch, you can also use the github_sync and github_publish tools. The workspace has team channels where its humans talk to each other: read them with read_team_chat when the request depends on intent, priorities, or decisions that are not in the repository, and use post_team_chat to answer a question you were mentioned in or to report a blocking finding where the team will see it. Do not merge into the integration worktree or escape this worktree.",
      messages: [{ role: "user", content: modelInput(context, transcript) }],
      tools: createAgentTools(context),
      onStepEnd: async ({ text, response: stepResponse, usage }) => {
        if (text) {
          finalOutput = text;
          const stepUsage = normalizeTokenUsage(usage);
          await addEvent(context, `${stepResponse.id}:output`, "agent.output", {
            text,
            ...(stepUsage ? { usage: stepUsage } : {}),
          });
        }
      },
    });
    finalOutput = (response.text || finalOutput).trim();
    if (!finalOutput) {
      const executedTools = response.steps.flatMap((step) =>
        step.toolCalls.map((tc) => tc.toolName),
      );
      if (executedTools.length > 0) {
        const uniqueTools = Array.from(new Set(executedTools));
        finalOutput = `Completed turn: executed ${executedTools.length} operation(s) using ${uniqueTools.join(", ")}.`;
      } else {
        finalOutput = "Completed requested task.";
      }
    }
    const totalUsage = normalizeTokenUsage(
      response.totalUsage ?? response.usage,
    );

    if (await turnWasInterrupted(turnId)) return { kind: "done" };
    await getDatabase()
      .update(schema.agentTurns)
      .set({
        status: "completed",
        responseId: response.response.id,
        output: finalOutput,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.agentTurns.id, turnId));
    await addEvent(context, `${turnId}:completed`, "turn.completed", {
      output: finalOutput,
      ...(totalUsage ? { usage: totalUsage } : {}),
    });
    await recordTurnOutcomeInBrain(context, finalOutput);
    return { kind: "done" };
  }
}

/**
 * After a turn lands, leave a trace in the workspace brain — an `attempt`
 * entry other agents can find — and recompute overlaps with the turn's own
 * model behind the duplicate-work check. Everything here is best-effort.
 */
async function recordTurnOutcomeInBrain(
  context: AgentContext,
  outcome: string,
) {
  const title = context.prompt.split("\n")[0]?.slice(0, 180) || "Agent turn";
  try {
    await recordBrainEntry(
      context.workspaceId,
      context.sessionId,
      context.authorId,
      {
        kind: "attempt",
        title,
        body: outcome.slice(0, 4_000),
        paths: [],
      },
    );
  } catch {
    // The history note is advisory.
  }

  let adjudicator: OverlapAdjudicator | undefined;
  try {
    const provider = parseAgentProvider(context.provider);
    if (provider !== "cursor") {
      const credential = await assertProviderConnectionForTurn(
        context.authorId,
        context.workspaceId,
        provider,
      );
      if (
        credential.authType !== "HOSTED_CODEX_SUBSCRIPTION" &&
        credential.authType !== "CLAUDE_RUNTIME"
      ) {
        adjudicator = createModelOverlapAdjudicator(
          createAgentModel(
            credential,
            context.model || getAgentModel(provider),
          ),
        );
      }
    }
  } catch {
    adjudicator = undefined;
  }
  await safeDetectOverlaps(
    context.workspaceId,
    adjudicator ? { adjudicator } : {},
  );
}

/**
 * A "use step" entry point for the workflow-level polling loop's
 * interruption check. Deliberately separate from turnWasInterrupted, which
 * is also called directly (nested, not as a fresh step boundary) from
 * inside prepareAgentTurn/finishCodexTurn — only ever giving THIS function
 * its own step keeps that nested usage unaffected.
 */
export async function checkTurnInterrupted(turnId: string) {
  "use step";
  return turnWasInterrupted(turnId);
}

export async function pollCodexTurn(
  workspaceId: string,
  codexSessionId: string,
  after: number,
) {
  "use step";
  return pollCodexExecInSandbox(workspaceId, codexSessionId, after);
}

/**
 * Ends a hosted Codex turn early — either the normal poll loop discovering
 * the turn was interrupted, or (defensively) any other early-exit path.
 * Kills the guest-side process and releases the execution lease that
 * prepareAgentTurn claimed; finishCodexTurn handles both of those itself
 * for the normal-completion path, so this is only for cancellation.
 */
export async function cancelCodexTurn(
  workspaceId: string,
  codexSessionId: string,
  credentialId: string,
) {
  "use step";
  await closeCodexExecInSandbox(workspaceId, codexSessionId);
  await releaseHostedCodexExecution(credentialId);
}

export async function finishCodexTurn(
  turnId: string,
  credentialId: string,
  poll: { output: string; exitCode: number; codexAuthCacheJson?: string },
) {
  "use step";
  const context = await loadAgentContext(turnId);
  try {
    if (poll.codexAuthCacheJson) {
      await updateHostedCodexAuthCache(credentialId, poll.codexAuthCacheJson);
    }
  } finally {
    await releaseHostedCodexExecution(credentialId);
  }
  if (poll.exitCode !== 0) {
    throw new Error(
      "The official Codex CLI could not complete this turn. Reconnect with `codev codex-auth` if the subscription login expired.",
    );
  }
  const finalOutput = codexFinalMessage(poll.output);
  if (!finalOutput) {
    throw new Error(
      "The official Codex CLI completed without a final response.",
    );
  }
  if (await turnWasInterrupted(turnId)) return;
  await getDatabase()
    .update(schema.agentTurns)
    .set({
      status: "completed",
      output: finalOutput,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.agentTurns.id, turnId));
  await addEvent(context, `${turnId}:output:final`, "agent.output", {
    text: finalOutput,
  });
  await addEvent(context, `${turnId}:completed`, "turn.completed", {
    output: finalOutput,
  });
  await recordTurnOutcomeInBrain(context, finalOutput);
}

export async function failCurrentTurnKeepSession(
  turnId: string,
  sessionId: string,
  message: string,
) {
  const now = new Date();
  const clipped = message.slice(0, 2_000);
  await getDatabase()
    .update(schema.agentTurns)
    .set({
      status: "failed",
      lastError: clipped,
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.agentTurns.id, turnId));
  await getDatabase()
    .update(schema.agentSessions)
    .set({
      lastError: clipped,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.agentSessions.id, sessionId),
        eq(schema.agentSessions.status, "running"),
      ),
    );
}

export async function failAgentSession(sessionId: string, message: string) {
  "use step";

  const [session] = await getDatabase()
    .update(schema.agentSessions)
    .set({
      status: "failed",
      lastError: message.slice(0, 2_000),
      workflowRunId: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.agentSessions.id, sessionId))
    .returning({ workspaceId: schema.agentSessions.workspaceId });
  if (session) {
    await notifyWorkspaceMembers(session.workspaceId, sessionId, "failed", {
      lastError: message,
    });
  }
  await getDatabase()
    .update(schema.agentTurns)
    .set({
      status: "failed",
      lastError: message.slice(0, 2_000),
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.agentTurns.sessionId, sessionId),
        eq(schema.agentTurns.status, "running"),
      ),
    );
}

import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import OpenAI from "openai";

import { schema } from "@codev/db";

import { getOpenAIApiKey } from "./credentials";
import { getDatabase } from "./database";
import {
  createCoordinationMessage,
  createPathClaim,
  listCoordinationMessages,
  listPathClaims,
  listWorkspacePathClaims,
  releasePathClaim,
  requireActivePathClaim,
  updateCoordinationMessageStatus,
} from "./agent-coordination";
import {
  executeInSandbox,
  getSandboxGitOutput,
  readSandboxFile,
  writeSandboxFile,
} from "./orchestrator";

const MODEL = "gpt-5.6-sol";
const MAX_TOOL_ROUNDS = 12;

const tools: OpenAI.Responses.Tool[] = [
  {
    type: "function",
    name: "claim_path",
    description:
      "Claim one exact relative path or directory/** before writing files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        intent: { type: "string" },
        revision: { type: "string" },
      },
      required: ["path", "intent", "revision"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "release_claim",
    description: "Release one of this session's path claims.",
    parameters: {
      type: "object",
      properties: { claimId: { type: "string" } },
      required: ["claimId"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_claims",
    description:
      "List active and contested path claims across both workspace agents.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "contest_path",
    description:
      "Create a contested claim after an overlap, so the owning agents can negotiate.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        intent: { type: "string" },
        revision: { type: "string" },
      },
      required: ["path", "intent", "revision"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_coordination",
    description: "List structured messages sent to or from this agent session.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "request_claim_coordination",
    description:
      "Ask another agent to coordinate an overlapping claim using a correlated request.",
    parameters: {
      type: "object",
      properties: {
        toSessionId: { type: "string" },
        claimId: { type: "string" },
        path: { type: "string" },
        intent: { type: "string" },
      },
      required: ["toSessionId", "claimId", "path", "intent"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "respond_to_claim",
    description:
      "Respond to a claim request with an accept, reject, or counter decision.",
    parameters: {
      type: "object",
      properties: {
        toSessionId: { type: "string" },
        responseToId: { type: "string" },
        correlationId: { type: "string" },
        claimId: { type: "string" },
        decision: { type: "string", enum: ["accept", "reject", "counter"] },
        reason: { type: "string" },
      },
      required: [
        "toSessionId",
        "responseToId",
        "correlationId",
        "claimId",
        "decision",
        "reason",
      ],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "resolve_coordination",
    description:
      "Mark a coordination message delivered or resolved after acting on it.",
    parameters: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        status: { type: "string", enum: ["delivered", "resolved"] },
      },
      required: ["messageId", "status"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_files",
    description: "List repository files in this agent's isolated worktree.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "read_file",
    description: "Read a UTF-8 repository file and its revision.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "write_file",
    description:
      "Write a UTF-8 repository file. Read it first and pass its current revision.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        contents: { type: "string" },
        expectedRevision: { type: "string" },
      },
      required: ["path", "contents", "expectedRevision"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "run_command",
    description:
      "Run a bounded non-interactive command in the isolated worktree. Pass argv without a shell.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "array", items: { type: "string" } },
      },
      required: ["command"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "git_status",
    description: "Inspect Git status for this isolated worktree.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
];

type AgentContext = {
  turnId: string;
  sessionId: string;
  workspaceId: string;
  worktreeId: string;
  authorId: string;
  model: string;
  prompt: string;
};

async function addEvent(
  context: Pick<AgentContext, "workspaceId" | "sessionId" | "turnId">,
  idempotencyKey: string,
  type: string,
  payload: Record<string, unknown>,
) {
  await getDatabase()
    .insert(schema.agentEvents)
    .values({ ...context, idempotencyKey, type, payload })
    .onConflictDoNothing({ target: schema.agentEvents.idempotencyKey });
}

export async function claimNextAgentTurn(sessionId: string) {
  "use step";

  let [turn] = await getDatabase()
    .select({ id: schema.agentTurns.id })
    .from(schema.agentTurns)
    .where(
      and(
        eq(schema.agentTurns.sessionId, sessionId),
        eq(schema.agentTurns.status, "queued"),
      ),
    )
    .orderBy(asc(schema.agentTurns.createdAt))
    .limit(1);

  if (!turn) {
    await getDatabase()
      .update(schema.agentSessions)
      .set({ status: "idle", workflowRunId: null, updatedAt: new Date() })
      .where(eq(schema.agentSessions.id, sessionId));
    // Close the handoff race with a follow-up inserted while the session was
    // still marked running. A concurrent kicker may also see idle; the
    // queued→running conditional update below ensures only one workflow wins.
    [turn] = await getDatabase()
      .select({ id: schema.agentTurns.id })
      .from(schema.agentTurns)
      .where(
        and(
          eq(schema.agentTurns.sessionId, sessionId),
          eq(schema.agentTurns.status, "queued"),
        ),
      )
      .orderBy(asc(schema.agentTurns.createdAt))
      .limit(1);
    if (!turn) return null;
    await getDatabase()
      .update(schema.agentSessions)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(schema.agentSessions.id, sessionId));
  }

  const [claimed] = await getDatabase()
    .update(schema.agentTurns)
    .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.agentTurns.id, turn.id),
        eq(schema.agentTurns.status, "queued"),
      ),
    )
    .returning({ id: schema.agentTurns.id });
  return claimed?.id ?? null;
}

async function loadAgentContext(turnId: string): Promise<AgentContext> {
  const [row] = await getDatabase()
    .select({
      turnId: schema.agentTurns.id,
      sessionId: schema.agentSessions.id,
      workspaceId: schema.agentSessions.workspaceId,
      worktreeId: schema.agentSessions.worktreeId,
      authorId: schema.agentTurns.authorId,
      model: schema.agentSessions.model,
      prompt: schema.agentTurns.prompt,
    })
    .from(schema.agentTurns)
    .innerJoin(
      schema.agentSessions,
      eq(schema.agentTurns.sessionId, schema.agentSessions.id),
    )
    .where(eq(schema.agentTurns.id, turnId))
    .limit(1);
  if (!row) throw new Error("Agent turn not found.");
  return row;
}

async function turnWasInterrupted(turnId: string) {
  const [turn] = await getDatabase()
    .select({ status: schema.agentTurns.status })
    .from(schema.agentTurns)
    .where(eq(schema.agentTurns.id, turnId))
    .limit(1);
  return turn?.status === "interrupted";
}

function cleanPath(path: unknown) {
  if (
    typeof path !== "string" ||
    !path ||
    path.startsWith("/") ||
    path.split("/").includes("..")
  ) {
    throw new Error("Tool path must stay inside the worktree.");
  }
  return path;
}

export function validateAgentCommand(command: string[]) {
  if (
    command.length < 1 ||
    command.length > 16 ||
    command.some(
      (part) =>
        !part ||
        part.includes("\0") ||
        part.startsWith("/") ||
        part.split("/").includes(".."),
    )
  ) {
    throw new Error("Command arguments must stay inside the worktree.");
  }
  const executable = command[0] ?? "";
  const readOnlyExecutables = new Set([
    "rg",
    "grep",
    "find",
    "ls",
    "pwd",
    "cat",
    "head",
    "tail",
    "wc",
    "test",
  ]);
  if (executable === "git") {
    const operation = command[1] ?? "";
    if (
      !new Set([
        "status",
        "diff",
        "log",
        "show",
        "grep",
        "rev-parse",
        "ls-files",
      ]).has(operation) ||
      command.some(
        (part) =>
          part === "-C" ||
          part.startsWith("--git-dir") ||
          part.startsWith("--work-tree"),
      )
    ) {
      throw new Error("Only read-only Git inspection commands are allowed.");
    }
    return command;
  }
  if (executable === "pnpm") {
    const operation = command[1] ?? "";
    if (
      !new Set([
        "test",
        "lint",
        "typecheck",
        "build",
        "format:check",
        "rust:check",
      ]).has(operation)
    ) {
      throw new Error("Only verification pnpm scripts are allowed.");
    }
    return command;
  }
  if (executable === "npm") {
    if (
      command[1] !== "run" ||
      !new Set(["test", "lint", "typecheck", "build"]).has(command[2] ?? "")
    ) {
      throw new Error("Only verification npm scripts are allowed.");
    }
    return command;
  }
  if (executable === "cargo") {
    const operation = command[1] ?? "";
    if (
      !new Set(["check", "test", "clippy", "fmt"]).has(operation) ||
      (operation === "fmt" && !command.includes("--check"))
    ) {
      throw new Error("Only non-mutating Cargo verification is allowed.");
    }
    return command;
  }
  if (!readOnlyExecutables.has(executable)) {
    throw new Error(`Command ${executable} is outside the agent boundary.`);
  }
  return command;
}

async function executeTool(
  context: AgentContext,
  name: string,
  rawArguments: string,
) {
  const input = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  switch (name) {
    case "list_files": {
      const result = await executeInSandbox(context.workspaceId, {
        worktreeId: context.worktreeId,
        command: [
          "find",
          ".",
          "-type",
          "f",
          "-not",
          "-path",
          "./.git",
          "-not",
          "-path",
          "./.git/*",
          "-not",
          "-path",
          "./node_modules/*",
          "-not",
          "-path",
          "./target/*",
        ],
        timeoutSeconds: 30,
      });
      return result.output.slice(0, 80_000);
    }
    case "read_file": {
      return JSON.stringify(
        await readSandboxFile(
          context.workspaceId,
          cleanPath(input.path),
          context.worktreeId,
        ),
      );
    }
    case "write_file": {
      if (
        typeof input.contents !== "string" ||
        typeof input.expectedRevision !== "string"
      ) {
        throw new Error("write_file requires contents and expectedRevision.");
      }
      const path = cleanPath(input.path);
      await requireActivePathClaim(
        context.workspaceId,
        context.sessionId,
        path,
        input.expectedRevision,
      );
      return JSON.stringify(
        await writeSandboxFile(context.workspaceId, {
          path,
          contents: input.contents,
          expectedRevision: input.expectedRevision,
          worktreeId: context.worktreeId,
        }),
      );
    }
    case "claim_path": {
      return JSON.stringify(
        await createPathClaim(context.workspaceId, context.sessionId, {
          path: input.path,
          intent: input.intent,
          revision: input.revision,
        }),
      );
    }
    case "release_claim": {
      if (typeof input.claimId !== "string") {
        throw new Error("release_claim requires a claimId.");
      }
      return JSON.stringify(
        await releasePathClaim(
          context.workspaceId,
          context.sessionId,
          input.claimId,
        ),
      );
    }
    case "list_claims":
      return JSON.stringify(
        await listWorkspacePathClaims(context.workspaceId, context.sessionId),
      );
    case "contest_path":
      return JSON.stringify(
        await createPathClaim(context.workspaceId, context.sessionId, {
          path: input.path,
          intent: input.intent,
          revision: input.revision,
          contest: true,
        }),
      );
    case "list_coordination":
      return JSON.stringify(
        await listCoordinationMessages(context.workspaceId, context.sessionId),
      );
    case "request_claim_coordination":
      return JSON.stringify(
        await createCoordinationMessage(
          context.workspaceId,
          context.sessionId,
          {
            toSessionId: input.toSessionId,
            kind: "claim_request",
            payload: {
              claimId: input.claimId,
              path: input.path,
              intent: input.intent,
            },
          },
        ),
      );
    case "respond_to_claim":
      return JSON.stringify(
        await createCoordinationMessage(
          context.workspaceId,
          context.sessionId,
          {
            toSessionId: input.toSessionId,
            kind: "claim_response",
            correlationId: input.correlationId,
            responseToId: input.responseToId,
            payload: {
              claimId: input.claimId,
              decision: input.decision,
              reason: input.reason,
            },
          },
        ),
      );
    case "resolve_coordination": {
      if (
        typeof input.messageId !== "string" ||
        (input.status !== "delivered" && input.status !== "resolved")
      ) {
        throw new Error(
          "resolve_coordination requires a messageId and valid status.",
        );
      }
      return JSON.stringify(
        await updateCoordinationMessageStatus(
          context.workspaceId,
          context.sessionId,
          input.messageId,
          input.status,
        ),
      );
    }
    case "git_status":
      return await getSandboxGitOutput(
        context.workspaceId,
        "status",
        context.worktreeId,
      );
    case "run_command": {
      if (
        !Array.isArray(input.command) ||
        input.command.length < 1 ||
        input.command.length > 16 ||
        !input.command.every((part) => typeof part === "string")
      ) {
        throw new Error("run_command requires 1-16 string arguments.");
      }
      const command = validateAgentCommand(input.command as string[]);
      const result = await executeInSandbox(context.workspaceId, {
        worktreeId: context.worktreeId,
        command,
        timeoutSeconds: 30,
      });
      return JSON.stringify({
        output: result.output.slice(0, 80_000),
        exitCode: result.exitCode,
      });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function runAgentTurn(turnId: string) {
  "use step";

  const context = await loadAgentContext(turnId);
  const apiKey = await getOpenAIApiKey(context.authorId);
  const client = new OpenAI({ apiKey });
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
  const transcript = history
    .map(
      (turn) =>
        `User request:\n${turn.prompt}\n\nAgent result:\n${turn.output ?? "(in progress)"}`,
    )
    .join("\n\n---\n\n");

  await addEvent(context, `${turnId}:started`, "turn.started", {
    prompt: context.prompt,
    model: context.model,
  });

  let input: OpenAI.Responses.ResponseInput = [
    {
      role: "user",
      content: `Repository session transcript:\n${transcript}\n\nComplete the latest request. Inspect the repository before editing.`,
    },
  ];
  let previousResponseId: string | undefined;
  let finalOutput = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    if (await turnWasInterrupted(turnId)) return;
    const response = await client.responses.create({
      model: context.model || MODEL,
      reasoning: { effort: "medium" },
      instructions:
        "You are a coding agent inside an isolated Git worktree. Deliver the requested repository change, verify it with focused commands, and finish with a concise outcome. Inspect workspace claims and coordination messages before editing. Before each write, claim the exact file at its read revision or claim a directory/** scope. If another agent overlaps, create a contested claim and negotiate through correlated claim requests and responses instead of overwriting. Release claims when work is complete. Use only the provided tools. Never publish, merge, access credentials, or escape the worktree.",
      input,
      tools,
      ...(previousResponseId
        ? { previous_response_id: previousResponseId }
        : {}),
    });
    previousResponseId = response.id;
    finalOutput = response.output_text || finalOutput;
    if (response.output_text) {
      await addEvent(context, `${response.id}:output`, "agent.output", {
        text: response.output_text,
      });
    }
    const calls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
        item.type === "function_call",
    );
    if (calls.length === 0) break;

    const toolOutputs: OpenAI.Responses.ResponseInputItem[] = [];
    for (const call of calls) {
      if (await turnWasInterrupted(turnId)) return;
      await addEvent(context, `${call.call_id}:called`, "tool.called", {
        name: call.name,
        arguments: call.arguments,
      });
      try {
        const output = await executeTool(context, call.name, call.arguments);
        await addEvent(context, `${call.call_id}:completed`, "tool.completed", {
          name: call.name,
          output: output.slice(0, 4_000),
        });
        toolOutputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Tool execution failed.";
        await addEvent(context, `${call.call_id}:failed`, "tool.failed", {
          name: call.name,
          error: message,
        });
        toolOutputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({ error: message }),
        });
      }
    }
    input = toolOutputs;
  }

  if (await turnWasInterrupted(turnId)) return;
  await getDatabase()
    .update(schema.agentTurns)
    .set({
      status: "completed",
      responseId: previousResponseId,
      output: finalOutput || "Completed without a textual summary.",
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.agentTurns.id, turnId));
  await addEvent(context, `${turnId}:completed`, "turn.completed", {
    output: finalOutput,
  });
}

export async function failAgentSession(sessionId: string, message: string) {
  "use step";

  await getDatabase()
    .update(schema.agentSessions)
    .set({
      status: "failed",
      lastError: message.slice(0, 2_000),
      workflowRunId: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.agentSessions.id, sessionId));
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

export async function listAgentSessions(workspaceId: string) {
  const sessions = await getDatabase()
    .select({
      id: schema.agentSessions.id,
      name: schema.agentSessions.name,
      model: schema.agentSessions.model,
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
    .where(eq(schema.agentSessions.workspaceId, workspaceId))
    .orderBy(asc(schema.agentSessions.createdAt));
  const result = [];
  for (const session of sessions) {
    const turns = await getDatabase()
      .select({
        id: schema.agentTurns.id,
        prompt: schema.agentTurns.prompt,
        status: schema.agentTurns.status,
        output: schema.agentTurns.output,
        lastError: schema.agentTurns.lastError,
        createdAt: schema.agentTurns.createdAt,
      })
      .from(schema.agentTurns)
      .where(eq(schema.agentTurns.sessionId, session.id))
      .orderBy(asc(schema.agentTurns.createdAt));
    const events = await getDatabase()
      .select({
        id: schema.agentEvents.id,
        type: schema.agentEvents.type,
        payload: schema.agentEvents.payload,
        createdAt: schema.agentEvents.createdAt,
      })
      .from(schema.agentEvents)
      .where(eq(schema.agentEvents.sessionId, session.id))
      .orderBy(desc(schema.agentEvents.createdAt))
      .limit(80);
    const [claims, messages] = await Promise.all([
      listPathClaims(workspaceId, session.id),
      listCoordinationMessages(workspaceId, session.id),
    ]);
    result.push({
      ...session,
      turns,
      events: events.reverse(),
      claims,
      messages,
    });
  }
  return result;
}

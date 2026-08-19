import "server-only";

import { generateText, jsonSchema, stepCountIs, tool, type ToolSet } from "ai";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import OpenAI from "openai";

import { schema, type AgentTurnAttachment } from "@codev/db";
import { createAgentEvent } from "@codev/shared-types";

import {
  createAgentModel,
  getAgentModel,
  parseAgentProvider,
} from "./ai-model";
import {
  requireCursorApiKey,
  runCursorCloudAgent,
} from "./cursor-agent-runtime";
import { getDatabase } from "./database";
import {
  ProviderConnectionRequiredError,
  assertProviderConnectionForTurn,
} from "./provider-turn-auth";
import { normalizeTokenUsage } from "./token-usage";
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
import { getStepMetadata } from "workflow";

import {
  closeCodexExecInSandbox,
  executeInSandbox,
  getSandboxGitOutput,
  pollCodexExecInSandbox,
  readSandboxFile,
  startCodexExecInSandbox,
  writeSandboxFile,
} from "./orchestrator";
import {
  claimHostedCodexExecution,
  releaseHostedCodexExecution,
  updateHostedCodexAuthCache,
} from "./hosted-codex-subscription-credentials";
import {
  publishAgentWorktreeToGitHub,
  syncAgentWorktreeWithGitHub,
} from "./agent-github";
import { appendWorkspaceStateEvent } from "./workspace-state";

const MAX_TOOL_ROUNDS = 12;

function codexFinalMessage(output: string) {
  let final = "";
  for (const line of output.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        item?: { type?: string; text?: string };
      };
      if (
        event.type === "item.completed" &&
        event.item?.type === "agent_message" &&
        typeof event.item.text === "string"
      ) {
        final = event.item.text;
      }
    } catch {
      // The official CLI may include a non-JSON diagnostic line. Never echo it
      // because provider diagnostics can contain sensitive metadata.
    }
  }
  return final.trim();
}

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
      "List active and contested path claims across all workspace agents.",
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
      "Run a bounded non-interactive command in the isolated worktree. Pass argv without a shell. Prefer find and grep for repository searches; optional tools such as rg may not be installed in every guest image.",
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
  {
    type: "function",
    name: "github_sync",
    description:
      "Sync this agent worktree with the workspace GitHub default branch tip via the control plane. Prefer this over git pull/fetch.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "github_publish",
    description:
      "Publish this agent worktree to an immutable codev/* branch on GitHub via the control plane. Prefer this over git push. Pass a codev/... branch name, or an empty string to use the default.",
    parameters: {
      type: "object",
      properties: {
        branchName: { type: "string" },
      },
      required: ["branchName"],
      additionalProperties: false,
    },
    strict: true,
  },
];

type PrepareAgentTurnResult =
  | { kind: "done" }
  | {
      kind: "codexPending";
      workspaceId: string;
      codexSessionId: string;
      turnId: string;
      credentialId: string;
    };

type AgentContext = {
  turnId: string;
  sessionId: string;
  workspaceId: string;
  worktreeId: string;
  authorId: string;
  model: string;
  provider: string;
  repository: string | null;
  baseSha: string | null;
  prompt: string;
  attachments: AgentTurnAttachment[];
};

function normalizeAttachments(value: unknown): AgentTurnAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const attachment = item as Record<string, unknown>;
    if (
      typeof attachment.name !== "string" ||
      typeof attachment.type !== "string" ||
      typeof attachment.size !== "number"
    ) {
      return [];
    }
    return [
      {
        name: attachment.name,
        type: attachment.type,
        size: attachment.size,
        ...(typeof attachment.text === "string"
          ? { text: attachment.text }
          : {}),
        ...(typeof attachment.data === "string"
          ? { data: attachment.data }
          : {}),
      },
    ];
  });
}

function publicAttachmentMetadata(value: unknown) {
  return normalizeAttachments(value).map(({ name, type, size }) => ({
    name,
    type,
    size,
  }));
}

function modelInput(context: AgentContext, transcript: string) {
  const parts: Array<
    | { type: "text"; text: string }
    | {
        type: "file";
        mediaType: string;
        data: { type: "data"; data: string };
      }
  > = [
    {
      type: "text",
      text: `Repository session transcript:\n${transcript}\n\nComplete the latest request. Inspect the repository before editing.`,
    },
  ];

  for (const attachment of context.attachments) {
    if (attachment.data && attachment.type.toLowerCase().startsWith("image/")) {
      parts.push({
        type: "file",
        mediaType: attachment.type,
        data: { type: "data", data: attachment.data },
      });
      continue;
    }
    if (attachment.text) {
      parts.push({
        type: "text",
        text: `Attached text file: ${attachment.name}\n${attachment.text}`,
      });
      continue;
    }
    parts.push({
      type: "text",
      text: `The user attached ${attachment.name} (${attachment.type || "unknown type"}, ${attachment.size} bytes). Its binary contents are not available to this agent input.`,
    });
  }

  return parts;
}

function eventProvider(provider: ReturnType<typeof parseAgentProvider>) {
  return provider === "openai"
    ? ("openai" as const)
    : provider === "anthropic" || provider === "bedrock"
      ? ("anthropic" as const)
      : ("custom" as const);
}

async function addEvent(
  context: AgentContext,
  idempotencyKey: string,
  type: string,
  payload: Record<string, unknown>,
) {
  const toolName =
    typeof payload.name === "string" ? payload.name : "workspace tool";
  const toolCallId =
    typeof payload.callId === "string" ? payload.callId : idempotencyKey;
  const output =
    typeof payload.text === "string"
      ? payload.text
      : typeof payload.output === "string"
        ? payload.output
        : undefined;
  const error = typeof payload.error === "string" ? payload.error : undefined;
  const canonicalType =
    type === "turn.started"
      ? "USER_PROMPT"
      : type === "agent.output" || type === "turn.completed"
        ? "AGENT_THOUGHT"
        : type === "tool.called"
          ? "TOOL_CALL_INIT"
          : "TOOL_CALL_RESULT";
  const provider = parseAgentProvider(context.provider);
  const agentEvent = createAgentEvent({
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    turnId: context.turnId,
    actor: {
      userId: context.authorId,
      userName: "CoDev workspace agent",
      avatarUrl: null,
    },
    modelProvider: eventProvider(provider),
    modelName: context.model || getAgentModel(provider),
    type: canonicalType,
    payload:
      canonicalType === "USER_PROMPT"
        ? { promptText: context.prompt }
        : canonicalType === "AGENT_THOUGHT"
          ? { outputStream: output ?? context.prompt }
          : canonicalType === "TOOL_CALL_INIT"
            ? {
                toolName,
                toolCallId,
                metadata: { arguments: payload.arguments ?? null },
              }
            : {
                toolName,
                toolCallId,
                outputStream: output,
                status: error ? "failed" : "completed",
                error,
              },
  });
  const [inserted] = await getDatabase()
    .insert(schema.agentEvents)
    .values({
      workspaceId: context.workspaceId,
      sessionId: context.sessionId,
      turnId: context.turnId,
      idempotencyKey,
      type,
      payload: { ...payload, agentEvent },
    })
    .onConflictDoNothing({ target: schema.agentEvents.idempotencyKey })
    .returning({ id: schema.agentEvents.id });
  if (inserted) await appendWorkspaceStateEvent(agentEvent);
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
      provider: schema.agentSessions.provider,
      repository: schema.workspaces.repository,
      baseSha: schema.workspaces.baseSha,
      prompt: schema.agentTurns.prompt,
      attachments: schema.agentTurns.attachments,
    })
    .from(schema.agentTurns)
    .innerJoin(
      schema.agentSessions,
      eq(schema.agentTurns.sessionId, schema.agentSessions.id),
    )
    .innerJoin(
      schema.workspaces,
      eq(schema.agentSessions.workspaceId, schema.workspaces.id),
    )
    .where(eq(schema.agentTurns.id, turnId))
    .limit(1);
  if (!row) throw new Error("Agent turn not found.");
  return { ...row, attachments: normalizeAttachments(row.attachments) };
}

export async function turnWasInterrupted(turnId: string) {
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
    if (
      command.some(
        (part) =>
          part === "-C" ||
          part.startsWith("--git-dir") ||
          part.startsWith("--work-tree"),
      )
    ) {
      throw new Error("Git commands must stay inside the worktree.");
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
    case "github_sync":
      return JSON.stringify(
        await syncAgentWorktreeWithGitHub({
          workspaceId: context.workspaceId,
          worktreeId: context.worktreeId,
          userId: context.authorId,
        }),
      );
    case "github_publish": {
      const branchName =
        typeof input.branchName === "string" && input.branchName.trim()
          ? input.branchName.trim()
          : undefined;
      return JSON.stringify(
        await publishAgentWorktreeToGitHub({
          workspaceId: context.workspaceId,
          worktreeId: context.worktreeId,
          userId: context.authorId,
          ...(branchName ? { branchName } : {}),
        }),
      );
    }
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
      let result;
      try {
        result = await executeInSandbox(context.workspaceId, {
          worktreeId: context.worktreeId,
          command,
          timeoutSeconds: 30,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Command execution failed.";
        if (
          /unable to spawn .*? because:.*(?:path|no such file)/i.test(message)
        ) {
          return JSON.stringify({
            output: `${message}\nUse find or grep when the requested executable is unavailable.`,
            exitCode: 127,
          });
        }
        throw error;
      }
      return JSON.stringify({
        output: result.output.slice(0, 80_000),
        exitCode: result.exitCode,
      });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function createAgentTools(context: AgentContext): ToolSet {
  const functionTools = tools.filter(
    (
      definition,
    ): definition is Extract<OpenAI.Responses.Tool, { type: "function" }> =>
      definition.type === "function",
  );
  return Object.fromEntries(
    functionTools.map((definition) => [
      definition.name,
      tool<Record<string, unknown>, string, never>({
        description: definition.description ?? "",
        inputSchema: jsonSchema<Record<string, unknown>>(
          definition.parameters as never,
        ),
        execute: async (input: Record<string, unknown>, options) => {
          await addEvent(
            context,
            `${options.toolCallId}:called`,
            "tool.called",
            {
              callId: options.toolCallId,
              name: definition.name,
              arguments: JSON.stringify(input),
            },
          );
          try {
            const output = await executeTool(
              context,
              definition.name,
              JSON.stringify(input),
            );
            await addEvent(
              context,
              `${options.toolCallId}:completed`,
              "tool.completed",
              {
                callId: options.toolCallId,
                name: definition.name,
                output: output.slice(0, 4_000),
              },
            );
            return output;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Tool execution failed.";
            await addEvent(
              context,
              `${options.toolCallId}:failed`,
              "tool.failed",
              {
                callId: options.toolCallId,
                name: definition.name,
                error: message,
              },
            );
            throw error;
          }
        },
      }),
    ]),
  ) as ToolSet;
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
  const transcript = history
    .map(
      (turn) =>
        `User request:\n${turn.prompt}\n\nAgent result:\n${turn.output ?? "(in progress)"}`,
    )
    .join("\n\n---\n\n");

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

  const model = createAgentModel(
    credential,
    context.model || getAgentModel(provider),
  );

  let finalOutput = "";
  const response = await generateText({
    model,
    maxOutputTokens: 4096,
    stopWhen: stepCountIs(MAX_TOOL_ROUNDS),
    system:
      "You are a coding agent inside an isolated Git worktree. Deliver the requested repository change, verify it with focused commands, and finish with a concise outcome. Always conclude your response with a clear textual summary explaining what was accomplished or checked. Inspect workspace claims and coordination messages before editing. Before each write, claim the exact file at its read revision or claim a directory/** scope. If another agent overlaps, create a contested claim and negotiate through correlated claim requests and responses instead of overwriting. Release claims when work is complete. Use only the provided tools. Prefer find and grep instead of rg because optional utilities may be absent from the guest image. A nonzero command exit code is diagnostic output; continue when it is safe to do so. You may run any Git commands inside this worktree (e.g. status, pull, push, commit, etc.). For GitHub remote sync or publishing to a codev/* branch, you can also use the github_sync and github_publish tools. Do not merge into the integration worktree or escape this worktree.",
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
  const totalUsage = normalizeTokenUsage(response.totalUsage ?? response.usage);

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
  return { kind: "done" };
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
      status: "idle",
      lastError: clipped,
      workflowRunId: null,
      updatedAt: now,
    })
    .where(eq(schema.agentSessions.id, sessionId));
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
    .where(eq(schema.agentSessions.workspaceId, workspaceId))
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

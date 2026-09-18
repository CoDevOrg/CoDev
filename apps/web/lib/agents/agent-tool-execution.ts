import "server-only";

import { jsonSchema, tool, type ToolSet } from "ai";
import type OpenAI from "openai";

import {
  createCoordinationMessage,
  createPathClaim,
  listCoordinationMessages,
  listWorkspacePathClaims,
  releasePathClaim,
  requireActivePathClaim,
  updateCoordinationMessageStatus,
} from "../coordination/agent-coordination";
import {
  recordBrainEntry,
  searchBrain,
  updateAgentBrief,
} from "../coordination/workspace-brain";
import {
  findChannelBySlug,
  postChannelMessage,
  readTeamChatContext,
} from "../chat/team-chat";
import {
  executeInSandbox,
  getSandboxGitOutput,
  readSandboxFile,
  writeSandboxFile,
} from "../runtime/orchestrator";
import {
  publishAgentWorktreeToGitHub,
  syncAgentWorktreeWithGitHub,
} from "./agent-github";
import { tools } from "./agent-tool-definitions";
import { addEvent, type AgentContext } from "./agent-turn-context";

/** Agents write `#general` the way people do; storage keys off the bare slug. */
function channelSlugArgument(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/^#/, "") : "";
}

/** How an agent signs its own channel posts. */
function agentChatLabel(context: { provider: string }) {
  const provider = context.provider.trim();
  return provider ? `Agent · ${provider}` : "Agent";
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
    case "read_team_chat": {
      const slug = channelSlugArgument(input.channel);
      return JSON.stringify(
        await readTeamChatContext(
          context.workspaceId,
          slug ? { channelSlug: slug } : {},
        ),
      );
    }
    case "post_team_chat": {
      const slug = channelSlugArgument(input.channel);
      if (!slug) throw new Error("post_team_chat requires a channel name.");
      if (typeof input.body !== "string" || input.body.trim().length === 0) {
        throw new Error("post_team_chat requires a message body.");
      }
      const channel = await findChannelBySlug(context.workspaceId, slug);
      if (!channel) throw new Error(`No channel named #${slug}.`);
      const { message } = await postChannelMessage({
        workspaceId: context.workspaceId,
        channelId: channel.id,
        body: input.body.trim(),
        author: {
          kind: "agent",
          label: agentChatLabel(context),
          agentSessionId: context.sessionId,
        },
      });
      return JSON.stringify({ posted: true, channel: slug, id: message.id });
    }
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
    case "brain_update_brief": {
      const patch: Record<string, unknown> = {};
      for (const key of [
        "goal",
        "approachSummary",
        "planSteps",
        "currentStep",
        "filesLikelyToTouch",
        "status",
      ]) {
        if (input[key] !== undefined) patch[key] = input[key];
      }
      if (!Object.keys(patch).length) {
        throw new Error(
          "brain_update_brief needs at least one of goal, approachSummary, planSteps, currentStep, filesLikelyToTouch, status.",
        );
      }
      return JSON.stringify(
        await updateAgentBrief(context.workspaceId, context.sessionId, patch),
      );
    }
    case "brain_search": {
      if (typeof input.query !== "string" || !input.query.trim()) {
        throw new Error("brain_search requires a query.");
      }
      return JSON.stringify(
        await searchBrain(context.workspaceId, context.sessionId, {
          query: input.query,
          limit: 8,
        }),
      );
    }
    case "brain_record":
      return JSON.stringify(
        await recordBrainEntry(
          context.workspaceId,
          context.sessionId,
          context.authorId,
          {
            kind: input.kind,
            title: input.title,
            body: typeof input.body === "string" ? input.body : "",
            paths: Array.isArray(input.paths) ? input.paths : [],
          },
        ),
      );
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

export function createAgentTools(context: AgentContext): ToolSet {
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

import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

import { createAgentEvent, type AgentEvent } from "@codev/shared-types";

import { apiError, getApiUser } from "@/lib/api";
import {
  createAgentModel,
  getAgentModel,
  getAgentProvider,
} from "@/lib/ai-model";
import { requireWorkspacePermission } from "@/lib/access";
import { resolveAgentCredential } from "@/lib/credentials";
import {
  AgentPromptRateLimitError,
  enforceAgentPromptRateLimit,
} from "@/lib/agent-rate-limit";
import { readSandboxFile, searchSandboxFiles } from "@/lib/orchestrator";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";
import { appendWorkspaceStateEvent } from "@/lib/workspace-state";

export const runtime = "nodejs";

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(50_000),
  sessionId: z.uuid().nullable().optional(),
  turnId: z.uuid().nullable().optional(),
});

type WireEvent =
  | { kind: "text"; delta: string; event: AgentEvent }
  | {
      kind: "tool-call";
      toolCallId: string;
      toolName: string;
      args: unknown;
      event: AgentEvent;
    }
  | {
      kind: "tool-result";
      toolCallId: string;
      toolName: string;
      result: unknown;
      event: AgentEvent;
    }
  | { kind: "error"; message: string; event: AgentEvent };

function record(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function safeWorkspacePath(value: string) {
  if (
    !value ||
    value.startsWith("/") ||
    value.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("Workspace paths must stay inside the sandbox.");
  }
  return value;
}

function safeAvatar(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return z.url().parse(value);
  } catch {
    return null;
  }
}

function eventFor(
  workspaceId: string,
  sessionId: string | null,
  turnId: string | null,
  actor: AgentEvent["actor"],
  type: AgentEvent["type"],
  payload: AgentEvent["payload"],
) {
  const provider = getAgentProvider();
  const modelProvider: AgentEvent["modelProvider"] =
    provider === "openai"
      ? "openai"
      : provider === "anthropic" || provider === "bedrock"
        ? "anthropic"
        : "custom";
  return createAgentEvent({
    workspaceId,
    sessionId,
    turnId,
    actor,
    modelProvider,
    modelName: getAgentModel(provider),
    type,
    payload,
  });
}

function toWireLine(value: WireEvent) {
  return `${JSON.stringify(value)}\n`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getApiUser();
  if (!user) return apiError(new Error("Authentication required."), 401);

  const { workspaceId } = await params;
  try {
    await requireWorkspacePermission(workspaceId, user.id, "coSteer");
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 403,
    );
  }

  try {
    const input = requestSchema.parse(await request.json());
    await ensureWorkspaceRuntimeReady(workspaceId, user.id);
    const actor: AgentEvent["actor"] = {
      userId: z.uuid().parse(user.id),
      userName:
        typeof user.name === "string" && user.name.trim().length > 0
          ? user.name.trim()
          : typeof user.email === "string" && user.email.length > 0
            ? user.email
            : "CoDev user",
      avatarUrl: safeAvatar(user.image),
    };
    const provider = getAgentProvider();
    await enforceAgentPromptRateLimit(user.id, workspaceId, provider);
    const credential = await resolveAgentCredential(
      user.id,
      workspaceId,
      provider,
    );
    const model = createAgentModel(credential, getAgentModel(provider));
    const result = streamText({
      model,
      maxOutputTokens: 4096,
      abortSignal: request.signal,
      stopWhen: stepCountIs(3),
      system:
        "You are CoDev's workspace agent. Inspect before editing, keep changes bounded, and use the workspace tools to show execution and proposed diffs.",
      prompt: input.prompt,
      tools: {
        inspectWorkspace: tool({
          description:
            "Inspect a bounded path or search query in the active workspace.",
          inputSchema: z.object({ query: z.string().trim().min(1).max(200) }),
          execute: async ({ query }) => ({
            query,
            ...(await (async () => {
              const pathLike =
                /^[A-Za-z0-9_./-]+$/.test(query) && !query.includes("..");
              if (pathLike) {
                try {
                  const file = await readSandboxFile(
                    workspaceId,
                    safeWorkspacePath(query),
                  );
                  return {
                    status: "file read",
                    path: file.path,
                    contents: file.contents.slice(0, 80_000),
                    revision: file.revision,
                  };
                } catch {
                  // Treat a path-shaped query that is not a file as a search.
                }
              }
              return {
                status: "search complete",
                output: (await searchSandboxFiles(workspaceId, query)).slice(
                  0,
                  80_000,
                ),
              };
            })()),
          }),
        }),
        proposeFileChange: tool({
          description:
            "Propose a unified diff for a workspace file without applying it.",
          inputSchema: z.object({
            filePath: z.string().trim().min(1).max(500),
            diffContent: z.string().max(50_000),
          }),
          execute: async ({ filePath, diffContent }) => ({
            filePath: safeWorkspacePath(filePath),
            diffContent,
            status: "proposal ready for review",
          }),
        }),
      },
    });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: WireEvent) => {
          controller.enqueue(encoder.encode(toWireLine(event)));
        };
        const persistAndSend = async (event: WireEvent) => {
          await appendWorkspaceStateEvent(event.event);
          send(event);
        };
        const sessionId = input.sessionId ?? null;
        const turnId = input.turnId ?? null;

        await persistAndSend({
          kind: "text",
          delta: "",
          event: eventFor(
            workspaceId,
            sessionId,
            turnId,
            actor,
            "USER_PROMPT",
            {
              promptText: input.prompt,
            },
          ),
        });

        try {
          for await (const part of result.fullStream) {
            if (request.signal.aborted) break;
            const current = record(part);
            if (part.type === "text-delta") {
              const delta = stringValue(current.text, "");
              if (!delta) continue;
              await persistAndSend({
                kind: "text",
                delta,
                event: eventFor(
                  workspaceId,
                  sessionId,
                  turnId,
                  actor,
                  "AGENT_THOUGHT",
                  { outputStream: delta },
                ),
              });
            } else if (part.type === "tool-call") {
              const toolName = stringValue(current.toolName, "workspace tool");
              const toolCallId = stringValue(
                current.toolCallId,
                crypto.randomUUID(),
              );
              const args = current.input ?? current.args ?? {};
              const payload = {
                toolName,
                toolCallId,
                metadata: { args },
              } satisfies AgentEvent["payload"];
              await persistAndSend({
                kind: "tool-call",
                toolCallId,
                toolName,
                args,
                event: eventFor(
                  workspaceId,
                  sessionId,
                  turnId,
                  actor,
                  "TOOL_CALL_INIT",
                  payload,
                ),
              });
              if (toolName === "proposeFileChange") {
                const argsRecord = record(args);
                const filePath = stringValue(
                  argsRecord.filePath,
                  "workspace file",
                );
                const diffContent = stringValue(argsRecord.diffContent, "");
                await persistAndSend({
                  kind: "text",
                  delta: "",
                  event: eventFor(
                    workspaceId,
                    sessionId,
                    turnId,
                    actor,
                    "FILE_DIFF_PROPOSED",
                    { filePath, diffContent },
                  ),
                });
              }
            } else if (part.type === "tool-result") {
              const toolName = stringValue(current.toolName, "workspace tool");
              const toolCallId = stringValue(
                current.toolCallId,
                "unknown-tool-call",
              );
              const toolResult = current.output ?? current.result ?? null;
              await persistAndSend({
                kind: "tool-result",
                toolCallId,
                toolName,
                result: toolResult,
                event: eventFor(
                  workspaceId,
                  sessionId,
                  turnId,
                  actor,
                  "TOOL_CALL_RESULT",
                  {
                    toolName,
                    toolCallId,
                    outputStream: JSON.stringify(toolResult),
                    status: "completed",
                  },
                ),
              });
            } else if (part.type === "error") {
              const message = stringValue(
                current.error,
                "Agent stream failed.",
              );
              await persistAndSend({
                kind: "error",
                message,
                event: eventFor(
                  workspaceId,
                  sessionId,
                  turnId,
                  actor,
                  "TOOL_CALL_RESULT",
                  { status: "failed", error: message },
                ),
              });
            }
          }
          if (request.signal.aborted) {
            try {
              await persistAndSend({
                kind: "text",
                delta: "",
                event: eventFor(
                  workspaceId,
                  sessionId,
                  turnId,
                  actor,
                  "INTERVENTION_PAUSE",
                  { status: "paused" },
                ),
              });
            } catch {
              // The client may have already closed the stream after cancelling.
            }
          }
        } catch (error) {
          if (request.signal.aborted) {
            try {
              await persistAndSend({
                kind: "text",
                delta: "",
                event: eventFor(
                  workspaceId,
                  sessionId,
                  turnId,
                  actor,
                  "INTERVENTION_PAUSE",
                  { status: "paused" },
                ),
              });
            } catch {
              // The client may have already closed the stream after cancelling.
            }
            return;
          }
          const message =
            error instanceof Error ? error.message : "Agent stream failed.";
          await persistAndSend({
            kind: "error",
            message,
            event: eventFor(
              workspaceId,
              sessionId,
              turnId,
              actor,
              "INTERVENTION_PAUSE",
              { status: "failed", error: message },
            ),
          });
        } finally {
          try {
            controller.close();
          } catch {
            // The client may have cancelled the response body.
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "application/x-ndjson; charset=utf-8",
      },
    });
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
    return apiError(error);
  }
}

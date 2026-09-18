import "server-only";

import { eq } from "drizzle-orm";

import { schema, type AgentTurnAttachment } from "@codev/db";
import { createAgentEvent } from "@codev/shared-types";

import { getDatabase } from "../platform/database";
import { getAgentModel, parseAgentProvider } from "../providers/ai-model";
import { appendWorkspaceStateEvent } from "../workspaces/workspace-state";

export type AgentContext = {
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

export function normalizeAttachments(value: unknown): AgentTurnAttachment[] {
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

export function publicAttachmentMetadata(value: unknown) {
  return normalizeAttachments(value).map(({ name, type, size }) => ({
    name,
    type,
    size,
  }));
}

export function modelInput(context: AgentContext, transcript: string) {
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

export async function addEvent(
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

export async function loadAgentContext(turnId: string): Promise<AgentContext> {
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

import { z } from "zod";

export const agentEventTypeSchema = z.enum([
  "USER_PROMPT",
  "AGENT_THOUGHT",
  "TOOL_CALL_INIT",
  "TOOL_CALL_RESULT",
  "FILE_DIFF_PROPOSED",
  "COMMENT_ADDED",
  "TERMINAL_EXEC_START",
  "TERMINAL_EXEC_END",
  "INTERVENTION_PAUSE",
]);

export const agentModelProviderSchema = z.enum([
  "anthropic",
  "openai",
  "custom",
]);

export const agentActorSchema = z.object({
  userId: z.uuid(),
  userName: z.string().min(1).max(255),
  avatarUrl: z.url().nullable(),
});

export const agentEventPayloadSchema = z.object({
  promptText: z.string().max(50_000).optional(),
  toolName: z.string().max(255).optional(),
  toolCallId: z.string().max(255).optional(),
  filePath: z.string().max(4_096).optional(),
  diffContent: z.string().max(2_000_000).optional(),
  commentText: z.string().max(10_000).optional(),
  command: z.string().max(4_096).optional(),
  exitCode: z.number().int().optional(),
  outputStream: z.string().max(2_000_000).optional(),
  status: z.string().max(64).optional(),
  error: z.string().max(2_000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const agentEventSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  sessionId: z.uuid().nullable(),
  turnId: z.uuid().nullable(),
  actor: agentActorSchema,
  modelProvider: agentModelProviderSchema,
  modelName: z.string().min(1).max(255),
  type: agentEventTypeSchema,
  payload: agentEventPayloadSchema,
  timestamp: z.number().int().nonnegative(),
});

export type AgentEventType = z.infer<typeof agentEventTypeSchema>;
export type AgentModelProvider = z.infer<typeof agentModelProviderSchema>;
export type AgentActor = z.infer<typeof agentActorSchema>;
export type AgentEventPayload = z.infer<typeof agentEventPayloadSchema>;
export type AgentEvent = z.infer<typeof agentEventSchema>;

export type AgentEventInput = Omit<AgentEvent, "id" | "timestamp"> & {
  id?: string;
  timestamp?: number;
};

export function createAgentEvent(input: AgentEventInput): AgentEvent {
  return agentEventSchema.parse({
    ...input,
    id: input.id ?? crypto.randomUUID(),
    timestamp: input.timestamp ?? Date.now(),
  });
}

export function agentEventToText(event: AgentEvent) {
  return (
    event.payload.outputStream ??
    event.payload.promptText ??
    event.payload.diffContent ??
    event.payload.commentText ??
    event.payload.error ??
    ""
  );
}

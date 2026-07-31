import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

import {
  agentEventSchema,
  createAgentEvent,
  type AgentEvent,
} from "@codev/shared-types";

export const DEFAULT_AGENT_MODEL =
  process.env.CODEV_OPENAI_MODEL?.trim() || "gpt-5";

const inputSchema = z.object({
  workspaceId: z.uuid(),
  sessionId: z.uuid().nullable(),
  turnId: z.uuid().nullable(),
  actor: z.object({
    userId: z.uuid(),
    userName: z.string().min(1),
    avatarUrl: z.url().nullable(),
  }),
  model: z.string().min(1).default(DEFAULT_AGENT_MODEL),
  prompt: z.string().min(1).max(50_000),
  apiKey: z.string().min(1),
});

export type AgentStreamInput = z.infer<typeof inputSchema>;

export function parseAgentStreamInput(value: unknown) {
  return inputSchema.parse(value);
}

function eventFor(
  input: AgentStreamInput,
  type: AgentEvent["type"],
  payload: AgentEvent["payload"],
) {
  return createAgentEvent({
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    actor: input.actor,
    modelProvider: "openai",
    modelName: input.model,
    type,
    payload,
  });
}

export function streamAgentTurn(input: AgentStreamInput) {
  const model = createOpenAI({ apiKey: input.apiKey })(input.model);
  return streamText({
    model,
    stopWhen: stepCountIs(3),
    system:
      "You are CoDev's coding agent. Explain work clearly, inspect before editing, and never publish or merge code.",
    prompt: input.prompt,
    tools: {
      inspectWorkspace: tool({
        description: "Request a bounded workspace inspection from the host.",
        inputSchema: z.object({ query: z.string().max(200) }),
        execute: async ({ query }) => ({ query, status: "queued" }),
      }),
    },
  });
}

export function agentStreamEvents(input: AgentStreamInput, text: string) {
  const events = [
    eventFor(input, "USER_PROMPT", { promptText: input.prompt }),
    eventFor(input, "AGENT_THOUGHT", { outputStream: text }),
  ];
  return events.map((event) => agentEventSchema.parse(event));
}

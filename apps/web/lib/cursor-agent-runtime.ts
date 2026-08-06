import "server-only";

import { Agent, type SDKMessage } from "@cursor/sdk";

import type { ResolvedCredential } from "./credentials";

export type CursorAgentProgressEvent =
  | { kind: "text"; text: string }
  | { kind: "status"; text: string }
  | { kind: "tool"; name: string }
  | {
      kind: "usage";
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    };

function textFromBlocks(
  content: Array<{ type: string; text?: string }> | undefined,
) {
  return (content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");
}

function describeSdkMessage(
  event: SDKMessage,
): CursorAgentProgressEvent | null {
  switch (event.type) {
    case "assistant": {
      const text = textFromBlocks(event.message.content);
      return text ? { kind: "text", text } : null;
    }
    case "thinking":
      return event.text ? { kind: "status", text: event.text } : null;
    case "status":
      return {
        kind: "status",
        text: event.message ?? `Cursor agent status: ${event.status}`,
      };
    case "tool_call":
      return { kind: "tool", name: event.name };
    case "usage":
      return {
        kind: "usage",
        usage: {
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          totalTokens: event.usage.totalTokens,
        },
      };
    default:
      return null;
  }
}

/**
 * Run one Cursor cloud agent prompt against the workspace GitHub repository.
 * Inference bills to the caller's Cursor API key.
 */
export async function runCursorCloudAgent(input: {
  apiKey: string;
  model: string;
  repository: string;
  startingRef?: string | null;
  prompt: string;
  onEvent?: (event: CursorAgentProgressEvent) => Promise<void> | void;
  signal?: AbortSignal;
}) {
  if (!input.apiKey.trim()) {
    throw new Error("A Cursor API key is required.");
  }
  if (!input.repository.trim()) {
    throw new Error("A GitHub repository is required for Cursor agents.");
  }

  await using agent = await Agent.create({
    apiKey: input.apiKey,
    model: { id: input.model },
    cloud: {
      repos: [
        {
          url: `https://github.com/${input.repository}`,
          ...(input.startingRef ? { startingRef: input.startingRef } : {}),
        },
      ],
    },
  });

  await input.onEvent?.({
    kind: "status",
    text: `Started Cursor cloud agent ${agent.agentId}.`,
  });
  const run = await agent.send(input.prompt);
  let finalText = "";
  let usage:
    | {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      }
    | undefined;

  for await (const event of run.stream()) {
    if (input.signal?.aborted) {
      await run.cancel();
      throw new Error("Cursor agent run was cancelled.");
    }
    const progress = describeSdkMessage(event);
    if (!progress) continue;
    if (progress.kind === "text") finalText = progress.text;
    if (progress.kind === "usage") usage = progress.usage;
    await input.onEvent?.(progress);
  }

  const result = await run.wait();
  if (result.error?.message) {
    throw new Error(result.error.message);
  }
  if (result.usage) {
    usage = {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    };
  }
  if (typeof result.result === "string" && result.result.trim()) {
    finalText = result.result;
  }
  if (!finalText.trim()) {
    finalText = `Cursor agent finished with status ${result.status}.`;
  }
  return {
    agentId: agent.agentId,
    output: finalText,
    status: result.status,
    ...(usage ? { usage } : {}),
  };
}

export function requireCursorApiKey(credential: ResolvedCredential) {
  if (credential.provider !== "cursor") {
    throw new Error("Expected a Cursor credential.");
  }
  if (!credential.apiKeyOrToken?.trim()) {
    throw new Error("The Cursor credential has no API key.");
  }
  return credential.apiKeyOrToken;
}

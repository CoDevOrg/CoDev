import "server-only";
import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { completeClaudeExecution } from "./claude-runtime-execution";

type RuntimeModel = Extract<LanguageModel, { specificationVersion: "v3" }>;
const answerSchema = z.object({
  text: z.string(),
  calls: z.array(z.object({ name: z.string(), inputJson: z.string() })).max(8),
});

/**
 * Keep CoDev's validated tool loop, claims, and workspace events. The official
 * CLI supplies each model response; it has no built-in filesystem/MCP tools in
 * the credential-owning runtime. Tool requests execute only in CoDev's existing
 * workspace tool boundary, never beside the subscription's profile.
 */
export function createClaudeRuntimeModel(
  userId: string,
  modelId: string,
): RuntimeModel {
  return {
    specificationVersion: "v3",
    provider: "claude-code",
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      if (
        options.prompt.some(
          (message) =>
            Array.isArray(message.content) &&
            message.content.some((part) => part.type === "file"),
        )
      ) {
        throw new Error(
          "Claude subscription execution currently accepts text only. Remove attachments or use an API-key model.",
        );
      }
      const available = (options.tools ?? []).filter(
        (tool) => tool.type === "function",
      );
      const tools =
        options.toolChoice?.type === "none"
          ? []
          : available.filter(
              (tool) =>
                options.toolChoice?.type !== "tool" ||
                tool.name === options.toolChoice.toolName,
            );
      const directSchema =
        !tools.length && options.responseFormat?.type === "json"
          ? options.responseFormat.schema
          : undefined;
      const outputSchema = directSchema ?? {
        type: "object",
        additionalProperties: false,
        required: ["text", "calls"],
        properties: {
          text: { type: "string" },
          calls: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "inputJson"],
              properties: {
                name: {
                  type: "string",
                  ...(tools.length
                    ? { enum: tools.map((tool) => tool.name) }
                    : {}),
                },
                inputJson: {
                  type: "string",
                  description:
                    "JSON-encoded object matching the selected tool's input schema",
                },
              },
            },
          },
        },
      };
      const prompt = `Continue the following CoDev conversation. CoDev executes the listed tools outside this private runtime and validates their arguments. Do not use local tools or inspect credentials. ${directSchema ? "Return the requested structured answer." : "Return text plus any tool requests in calls; when finished, calls must be empty. Only request listed tools."}\n${JSON.stringify({ messages: options.prompt, tools, toolChoice: options.toolChoice })}`;
      const result = await completeClaudeExecution(
        userId,
        modelId,
        prompt,
        outputSchema,
        options.abortSignal,
      );
      if (result.structured_output === undefined)
        throw new Error("Claude returned no structured answer.");
      const answer = directSchema
        ? { text: JSON.stringify(result.structured_output), calls: [] }
        : answerSchema.parse(result.structured_output);
      const content: Awaited<
        ReturnType<RuntimeModel["doGenerate"]>
      >["content"] = [];
      if (answer.text) content.push({ type: "text", text: answer.text });
      for (const call of answer.calls) {
        if (!tools.some((tool) => tool.name === call.name))
          throw new Error("Claude requested an unavailable tool.");
        const input: unknown = JSON.parse(call.inputJson);
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw new Error("Invalid Claude tool arguments.");
        content.push({
          type: "tool-call",
          toolCallId: randomUUID(),
          toolName: call.name,
          input: call.inputJson,
        });
      }
      return {
        content,
        finishReason: {
          unified: answer.calls.length ? "tool-calls" : "stop",
          raw: undefined,
        },
        usage: {
          inputTokens: {
            total: undefined,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: undefined,
            text: undefined,
            reasoning: undefined,
          },
        },
        warnings: [],
      };
    },
    async doStream(options) {
      const result = await this.doGenerate(options);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "stream-start",
              warnings: result.warnings,
            });
            for (const part of result.content) {
              if (part.type === "text") {
                const id = randomUUID();
                controller.enqueue({ type: "text-start", id });
                controller.enqueue({
                  type: "text-delta",
                  id,
                  delta: part.text,
                });
                controller.enqueue({ type: "text-end", id });
              } else if (part.type === "tool-call") controller.enqueue(part);
            }
            controller.enqueue({
              type: "finish",
              finishReason: result.finishReason,
              usage: result.usage,
            });
            controller.close();
          },
        }),
      };
    },
  };
}

import { z } from "zod";

export const claudeRuntimeReferenceSchema = z.discriminatedUnion("backend", [
  z
    .object({
      version: z.literal(1),
      backend: z.literal("subprocess"),
      profileId: z.uuid(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      backend: z.literal("orchestrator"),
      profileId: z.uuid(),
      sessionId: z.string().regex(/^claude-\d+-\d+$/),
    })
    .strict(),
]);
export type ClaudeRuntimeReference = z.infer<
  typeof claudeRuntimeReferenceSchema
>;
const prefix = "claude-login-v1:";

export function encodeClaudeRuntimeReference(
  reference: ClaudeRuntimeReference,
) {
  return prefix + JSON.stringify(claudeRuntimeReferenceSchema.parse(reference));
}

export function decodeClaudeRuntimeReference(value: string) {
  if (!value.startsWith(prefix))
    throw new Error("Reconnect Claude using the official runtime login.");
  return claudeRuntimeReferenceSchema.parse(
    JSON.parse(value.slice(prefix.length)),
  );
}

export function isClaudeRuntimeReference(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    decodeClaudeRuntimeReference(value);
    return true;
  } catch {
    return false;
  }
}

import { z } from "zod";

import { timestampSchema } from "./domain";

export const conversationImportPreviewInputSchema = z
  .object({
    url: z.url().max(2_048),
  })
  .strict();

export type ConversationImportPreviewInput = z.infer<
  typeof conversationImportPreviewInputSchema
>;

/**
 * Provider-neutral conversation data produced by an external chat importer.
 * Provider-specific payloads must be validated and converted to this shape
 * before they cross into persistence or product code.
 */
export const conversationImportSourceSchema = z.object({
  provider: z.string().trim().min(1).max(64),
  externalId: z.string().trim().min(1).max(512),
  url: z.url(),
  model: z.string().trim().min(1).max(200).nullable(),
  updatedAt: timestampSchema.nullable(),
});

export const importedConversationArtifactSchema = z.object({
  kind: z.enum(["image", "file"]),
  sourceUrl: z.url(),
  filename: z.string().trim().min(1).max(512),
  description: z.string().max(4_000).nullable(),
  downloadable: z.boolean(),
});

export const importedConversationMessageSchema = z.object({
  sequence: z.number().int().nonnegative(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  authorName: z.string().trim().min(1).max(200).nullable(),
  text: z.string(),
  sourceContentType: z.string().trim().min(1).max(100).nullable(),
  createdAt: timestampSchema.nullable(),
  artifacts: z.array(importedConversationArtifactSchema),
});

export const importedConversationSchema = z.object({
  source: conversationImportSourceSchema,
  title: z.string().trim().min(1).max(300),
  messages: z.array(importedConversationMessageSchema).min(1),
  warnings: z.array(z.string()),
});

export type ConversationImportSource = z.infer<
  typeof conversationImportSourceSchema
>;
export type ImportedConversationArtifact = z.infer<
  typeof importedConversationArtifactSchema
>;
export type ImportedConversationMessage = z.infer<
  typeof importedConversationMessageSchema
>;
export type ImportedConversation = z.infer<typeof importedConversationSchema>;

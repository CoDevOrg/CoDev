import {
  importedConversationSchema,
  type ImportedConversation,
} from "@codev/contracts";
import { z } from "zod";

import {
  parseChatGptShareHtml,
  type ChatGptParseOptions,
} from "./chatgpt-share-parser";

const chatGptShareAssetSchema = z.object({
  assetType: z.enum(["image", "file"]),
  url: z.url(),
  filename: z.string().trim().min(1).max(512),
  description: z.string().max(4_000).nullable(),
  downloadable: z.boolean(),
});

const chatGptShareReplySchema = z.object({
  authorName: z.string().trim().max(200),
  type: z.enum(["user", "assistant", "tool"]),
  statement: z.string(),
  createdAt: z.number().finite().nullable(),
  assets: z.array(chatGptShareAssetSchema),
});

export const chatGptShareConversationSchema = z.object({
  shareId: z.string().trim().min(1).max(512),
  aiModel: z.string().trim().max(200),
  title: z.string().trim().min(1).max(300),
  updatedAt: z.number().finite().nullable(),
  replies: z.array(chatGptShareReplySchema),
});

export type ChatGptShareConversation = z.infer<
  typeof chatGptShareConversationSchema
>;

function providerTimestampToIso(timestamp: number | null) {
  if (timestamp === null) return null;

  // Share parsers may expose Unix timestamps in seconds or milliseconds.
  const milliseconds =
    timestamp < 1_000_000_000_000 ? timestamp * 1_000 : timestamp;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    throw new Error("The imported conversation contains an invalid timestamp.");
  }
  return date.toISOString();
}

export function normalizeChatGptShareConversation(
  value: unknown,
  sourceUrl: string,
): ImportedConversation {
  const parsed = chatGptShareConversationSchema.parse(value);

  return importedConversationSchema.parse({
    source: {
      provider: "chatgpt",
      externalId: parsed.shareId,
      url: sourceUrl,
      model: parsed.aiModel || null,
      updatedAt: providerTimestampToIso(parsed.updatedAt),
    },
    title: parsed.title,
    messages: parsed.replies.map((reply, sequence) => ({
      sequence,
      role: reply.type,
      authorName: reply.authorName || null,
      text: reply.statement,
      sourceContentType: null,
      createdAt: providerTimestampToIso(reply.createdAt),
      artifacts: reply.assets.map((asset) => ({
        kind: asset.assetType,
        sourceUrl: asset.url,
        filename: asset.filename,
        description: asset.description,
        downloadable: asset.downloadable,
      })),
    })),
    warnings: [],
  });
}

export function importChatGptShareHtml(
  html: string,
  sourceUrl: string,
  options?: ChatGptParseOptions,
): ImportedConversation {
  const parsed = parseChatGptShareHtml(html, sourceUrl, options);
  return importedConversationSchema.parse({
    source: {
      provider: "chatgpt",
      externalId: parsed.shareId,
      url: sourceUrl,
      model: parsed.model,
      updatedAt: parsed.updatedAt,
    },
    title: parsed.title,
    messages: parsed.messages.map((message, sequence) => ({
      sequence,
      role: message.role,
      authorName: message.authorName,
      text: message.text,
      sourceContentType: message.contentType,
      createdAt: message.createdAt,
      artifacts: message.artifacts,
    })),
    warnings: parsed.warnings,
  });
}

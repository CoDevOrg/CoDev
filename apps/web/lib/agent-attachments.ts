import { z } from "zod";

import type { AgentTurnAttachment } from "@codev/db";

export const MAX_AGENT_ATTACHMENTS = 5;
export const MAX_AGENT_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const MAX_AGENT_ATTACHMENT_TEXT = 120_000;
export const MAX_AGENT_ATTACHMENT_DATA = 6_000_000;

const base64Data = z
  .string()
  .max(MAX_AGENT_ATTACHMENT_DATA)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, "Image data must be base64 encoded.");

const agentAttachmentSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    type: z.string().trim().max(120),
    size: z.number().int().nonnegative().max(MAX_AGENT_ATTACHMENT_SIZE),
    text: z.string().max(MAX_AGENT_ATTACHMENT_TEXT).optional(),
    data: base64Data.optional(),
  })
  .superRefine((attachment, context) => {
    const isImage = attachment.type.toLowerCase().startsWith("image/");
    if (isImage && !attachment.data) {
      context.addIssue({
        code: "custom",
        path: ["data"],
        message: "Image data is required for image attachments.",
      });
    }
    if (!isImage && attachment.data) {
      context.addIssue({
        code: "custom",
        path: ["data"],
        message: "Only image attachments may include inline data.",
      });
    }
  });

export const agentAttachmentsSchema = z
  .array(agentAttachmentSchema)
  .max(MAX_AGENT_ATTACHMENTS)
  .superRefine((attachments, context) => {
    const totalData = attachments.reduce(
      (total, attachment) => total + (attachment.data?.length ?? 0),
      0,
    );
    if (totalData > MAX_AGENT_ATTACHMENT_DATA) {
      context.addIssue({
        code: "custom",
        message: "The combined image attachments are too large.",
      });
    }
  })
  .default([]);

export type AgentAttachmentInput = z.infer<typeof agentAttachmentSchema>;

export function toStoredAgentAttachments(
  attachments: AgentAttachmentInput[],
): AgentTurnAttachment[] {
  return attachments.map((attachment) => ({
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    ...(attachment.text !== undefined ? { text: attachment.text } : {}),
    ...(attachment.data !== undefined ? { data: attachment.data } : {}),
  }));
}

import { z } from "zod";

import { identifierSchema, timestampSchema } from "./domain";

export const gen2WorkspaceStatusSchema = z.enum([
  "pending",
  "provisioning",
  "ready",
  "failed",
  "stopped",
]);

export const gen2WorkspaceRoleSchema = z.enum(["owner", "member"]);

export const gen2WorkspaceCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
});

export const gen2WorkspaceMemberSchema = z.object({
  userId: identifierSchema,
  login: z.string().min(1),
  name: z.string().nullable(),
  role: gen2WorkspaceRoleSchema,
});

export const gen2WorkspaceSchema = z.object({
  id: identifierSchema,
  name: z.string().min(1).max(80),
  status: gen2WorkspaceStatusSchema,
  sandboxId: z.string().min(1).nullable(),
  lastError: z.string().nullable(),
  role: gen2WorkspaceRoleSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const gen2WorkspaceDetailSchema = gen2WorkspaceSchema.extend({
  members: z.array(gen2WorkspaceMemberSchema),
});

export const gen2ShareResponseSchema = z.object({
  inviteUrl: z.url(),
});

export const gen2JoinRequestSchema = z.object({
  token: z.string().min(1),
});

export const gen2AgentStartRequestSchema = z.object({
  chatId: identifierSchema,
  prompt: z.string().trim().min(1).max(20_000),
  idempotencyKey: z.string().trim().min(8).max(128),
});

export const gen2AgentStartResponseSchema = z.object({
  sessionId: z.string().min(1).max(80),
});

export const gen2AgentPollRequestSchema = z.object({
  chatId: identifierSchema.optional(),
  sessionId: z.string().min(1).max(80),
  after: z.number().int().nonnegative(),
});

export const gen2AgentChunkSchema = z.object({
  sequence: z.number().int().nonnegative(),
  dataBase64: z.string(),
});

export const gen2AgentPollResponseSchema = z.object({
  chunks: z.array(gen2AgentChunkSchema),
  nextSequence: z.number().int().nonnegative(),
  exited: z.boolean(),
  exitCode: z.number().int().nullable(),
});

export const gen2AgentCancelRequestSchema = z.object({
  sessionId: z.string().min(1).max(80),
});

export const gen2ChatAppendRequestSchema = z.object({
  body: z.string().trim().min(1).max(100_000),
});

export const gen2ChatRoleSchema = z.enum(["user", "assistant"]);

export const gen2ChatMessageSchema = z.object({
  id: identifierSchema,
  role: gen2ChatRoleSchema,
  body: z.string().min(1),
  createdAt: timestampSchema,
});

export const gen2ChatSchema = z.object({
  id: identifierSchema,
  title: z.string().min(1).max(80),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const gen2ChatDetailSchema = gen2ChatSchema.extend({
  messages: z.array(gen2ChatMessageSchema),
});

export type Gen2WorkspaceStatus = z.infer<typeof gen2WorkspaceStatusSchema>;
export type Gen2WorkspaceRole = z.infer<typeof gen2WorkspaceRoleSchema>;
export type Gen2Workspace = z.infer<typeof gen2WorkspaceSchema>;
export type Gen2WorkspaceDetail = z.infer<typeof gen2WorkspaceDetailSchema>;
export type Gen2WorkspaceMember = z.infer<typeof gen2WorkspaceMemberSchema>;
export type Gen2AgentStartRequest = z.infer<typeof gen2AgentStartRequestSchema>;
export type Gen2AgentPollResponse = z.infer<typeof gen2AgentPollResponseSchema>;
export type Gen2Chat = z.infer<typeof gen2ChatSchema>;
export type Gen2ChatMessage = z.infer<typeof gen2ChatMessageSchema>;
export type Gen2ChatDetail = z.infer<typeof gen2ChatDetailSchema>;

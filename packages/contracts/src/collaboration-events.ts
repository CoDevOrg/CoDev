import { z } from "zod";

import { identifierSchema, timestampSchema } from "./domain";
import {
  gen2ChatMessageSchema,
  gen2ChatSchema,
  gen2TurnItemSchema,
  gen2TurnStatusSchema,
  gen2WorkspaceMemberSchema,
} from "./gen2";
import {
  gen2AgentProviderSchema,
  gen2SupersetWorktreeIdSchema,
} from "./gen2-identifiers";

/**
 * Workspace-wide realtime events carried by the Gen 2 collaboration socket.
 * They are not tied to an open document, so every member of the room receives
 * them. Paths here come from the server, so a bounded string is enough.
 */
const eventPathSchema = z.string().min(1).max(4_096);
const sessionIdSchema = z.string().min(1).max(200);

export const gen2RealtimeActorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: identifierSchema }),
  z.object({
    kind: z.literal("agent"),
    sessionId: sessionIdSchema,
    provider: gen2AgentProviderSchema,
    ownerUserId: identifierSchema,
    chatId: identifierSchema,
  }),
]);

/** The workbench area a member is looking at, for presence and follow mode. */
export const gen2WorkspaceViewSchema = z.enum([
  "chat",
  "files",
  "changes",
  "review",
  "browser",
  "board",
]);

const turnRef = {
  chatId: identifierSchema,
  sessionId: sessionIdSchema,
  userId: identifierSchema,
  provider: gen2AgentProviderSchema,
};

export const gen2RealtimeEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat.created"), chat: gen2ChatSchema }),
  z.object({ kind: z.literal("chat.updated"), chat: gen2ChatSchema }),
  z.object({
    kind: z.literal("chat.message"),
    chatId: identifierSchema,
    messageId: identifierSchema,
    /** Null when the message is too large to push; clients refetch the thread. */
    message: gen2ChatMessageSchema.nullable(),
    /** Set when this message renamed the chat (its first prompt). */
    title: z.string().min(1).max(80).optional(),
    updatedAt: timestampSchema,
  }),
  z.object({
    kind: z.literal("turn.started"),
    ...turnRef,
    worktreeId: gen2SupersetWorktreeIdSchema.nullable(),
    startedAt: timestampSchema,
  }),
  z.object({
    kind: z.literal("turn.progress"),
    ...turnRef,
    items: z.array(gen2TurnItemSchema).max(80),
    reply: z.string().max(32_000),
    truncated: z.boolean(),
  }),
  z.object({
    kind: z.literal("turn.settled"),
    ...turnRef,
    status: gen2TurnStatusSchema,
    message: gen2ChatMessageSchema.nullable(),
    changedPaths: z.array(eventPathSchema).max(200),
  }),
  z.object({
    kind: z.literal("files.changed"),
    worktreeId: gen2SupersetWorktreeIdSchema,
    paths: z.array(eventPathSchema).max(200),
    truncated: z.boolean(),
    actor: gen2RealtimeActorSchema,
  }),
  z.object({ kind: z.literal("worktrees.changed") }),
  z.object({
    kind: z.literal("members.changed"),
    members: z.array(gen2WorkspaceMemberSchema.omit({ email: true })).max(200),
  }),
  z.object({
    kind: z.literal("typing"),
    chatId: identifierSchema,
    userId: identifierSchema,
  }),
]);

export type Gen2RealtimeActor = z.infer<typeof gen2RealtimeActorSchema>;
export type Gen2WorkspaceView = z.infer<typeof gen2WorkspaceViewSchema>;
export type Gen2RealtimeEvent = z.infer<typeof gen2RealtimeEventSchema>;
export type Gen2RealtimeEventKind = Gen2RealtimeEvent["kind"];

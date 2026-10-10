import { z } from "zod";

import { identifierSchema, timestampSchema } from "./domain";
import {
  gen2RealtimeActorSchema,
  gen2RealtimeEventSchema,
  gen2WorkspaceViewSchema,
} from "./collaboration-events";
import { gen2AgentProviderSchema } from "./gen2-identifiers";

export const collaborationPathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (path) =>
      !path.includes("\0") &&
      !path.startsWith("/") &&
      !path.split("/").some((part) => part === "." || part === ".."),
    {
      message: "Collaboration paths must be relative workspace paths.",
    },
  );

export const yjsUpdateBase64Schema = z
  .string()
  .min(1)
  .max(350_000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const collaborationUserSchema = z.object({
  id: identifierSchema,
  login: z.string().min(1).max(255),
  name: z.string().max(255).nullable(),
  avatarUrl: z.url().nullable(),
});

// Gen 1 worktrees are database UUIDs; Gen 2 worktrees are safe host-service
// identifiers such as "main". The common socket transport carries either;
// each workspace adapter still validates and resolves its own identifier.
const collaborationWorktreeIdSchema = z.union([
  identifierSchema,
  z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
]);

const joinMessageSchema = z
  .object({
    type: z.literal("join"),
    worktreeId: collaborationWorktreeIdSchema.optional(),
    resumeFrom: z.string().min(1).max(128).optional(),
  })
  .strict();

const subscribeMessageSchema = z
  .object({
    type: z.literal("subscribe"),
    worktreeId: collaborationWorktreeIdSchema.optional(),
    path: collaborationPathSchema,
    stateVector: yjsUpdateBase64Schema.optional(),
  })
  .strict();

const updateMessageSchema = z
  .object({
    type: z.literal("update"),
    worktreeId: collaborationWorktreeIdSchema.optional(),
    path: collaborationPathSchema,
    update: yjsUpdateBase64Schema,
  })
  .strict();

const awarenessMessageSchema = z
  .object({
    type: z.literal("awareness"),
    worktreeId: collaborationWorktreeIdSchema.optional(),
    path: collaborationPathSchema,
    update: yjsUpdateBase64Schema,
  })
  .strict();

const unsubscribeMessageSchema = z
  .object({
    type: z.literal("unsubscribe"),
    worktreeId: collaborationWorktreeIdSchema.optional(),
    path: collaborationPathSchema,
  })
  .strict();

/** Where a member is in the workspace; drives presence and follow mode. */
const focusMessageSchema = z
  .object({
    type: z.literal("focus"),
    worktreeId: collaborationWorktreeIdSchema,
    path: collaborationPathSchema.nullable(),
    view: gen2WorkspaceViewSchema,
    chatId: identifierSchema.nullable(),
    away: z.boolean(),
  })
  .strict();

const typingMessageSchema = z
  .object({
    type: z.literal("typing"),
    chatId: identifierSchema,
  })
  .strict();

const heartbeatMessageSchema = z
  .object({
    type: z.literal("heartbeat"),
  })
  .strict();

export const collaborationClientMessageSchema = z.discriminatedUnion("type", [
  joinMessageSchema,
  subscribeMessageSchema,
  updateMessageSchema,
  awarenessMessageSchema,
  heartbeatMessageSchema,
  unsubscribeMessageSchema,
  focusMessageSchema,
  typingMessageSchema,
]);

const welcomeMessageSchema = z.object({
  type: z.literal("welcome"),
  connectionId: z.string().min(1),
  user: collaborationUserSchema,
  heartbeatIntervalMs: z.number().int().positive(),
  streamId: z.string().min(1),
});

const syncMessageSchema = z.object({
  type: z.literal("sync"),
  path: collaborationPathSchema,
  update: yjsUpdateBase64Schema,
  stateVector: yjsUpdateBase64Schema,
  revision: z.string().min(1),
});

const serverUpdateMessageSchema = z.object({
  type: z.literal("update"),
  worktreeId: collaborationWorktreeIdSchema,
  path: collaborationPathSchema,
  update: yjsUpdateBase64Schema,
  revision: z.string().min(1),
  actorId: identifierSchema,
  streamId: z.string().min(1),
});

const serverAwarenessMessageSchema = awarenessMessageSchema.extend({
  worktreeId: collaborationWorktreeIdSchema,
  actorId: identifierSchema,
  connectionId: z.string().min(1),
  streamId: z.string().min(1),
});

const presenceAgentSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    provider: gen2AgentProviderSchema,
    chatId: identifierSchema,
  })
  .strict();

export const collaborationPresenceEntrySchema = z.object({
  connectionId: z.string().min(1),
  user: collaborationUserSchema,
  path: collaborationPathSchema.nullable(),
  cursor: z
    .object({
      anchor: z.number().int().nonnegative(),
      head: z.number().int().nonnegative(),
    })
    .strict()
    .nullable()
    .default(null),
  worktreeId: collaborationWorktreeIdSchema.nullable().default(null),
  /** Set for a running agent; `user` is then the member who started it. */
  agent: presenceAgentSchema.nullable().default(null),
  view: gen2WorkspaceViewSchema.nullable().default(null),
  chatId: identifierSchema.nullable().default(null),
  away: z.boolean().default(false),
  lastSeenAt: timestampSchema,
});

const presenceMessageSchema = z.object({
  type: z.literal("presence"),
  members: z.array(collaborationPresenceEntrySchema).max(100),
});

const reconciledMessageSchema = z.object({
  type: z.literal("reconciled"),
  worktreeId: collaborationWorktreeIdSchema,
  path: collaborationPathSchema,
  revision: z.string().min(1),
  source: z.enum(["collaboration", "filesystem"]),
  update: yjsUpdateBase64Schema.optional(),
  /** Who changed the file, so editors can animate an agent's edit. */
  actor: gen2RealtimeActorSchema.optional(),
  /** The changed span in the new document text. */
  range: z
    .object({
      from: z.number().int().nonnegative(),
      to: z.number().int().nonnegative(),
    })
    .strict()
    .optional(),
});

const eventMessageSchema = z.object({
  type: z.literal("event"),
  event: gen2RealtimeEventSchema,
  streamId: z.string().min(1),
  at: timestampSchema,
});

const conflictMessageSchema = z.object({
  type: z.literal("conflict"),
  worktreeId: collaborationWorktreeIdSchema,
  path: collaborationPathSchema,
  snapshotRevision: z.string().min(1),
  filesystemRevision: z.string().min(1),
  message: z.string().min(1).max(1_000),
});

const errorMessageSchema = z.object({
  type: z.literal("error"),
  code: z.enum([
    "invalid_message",
    "not_joined",
    "not_subscribed",
    "not_found",
    "forbidden",
    "payload_too_large",
    "conflict",
    "internal_error",
  ]),
  message: z.string().min(1).max(1_000),
  retryable: z.boolean(),
  path: collaborationPathSchema.optional(),
});

export const collaborationServerMessageSchema = z.discriminatedUnion("type", [
  welcomeMessageSchema,
  syncMessageSchema,
  serverUpdateMessageSchema,
  serverAwarenessMessageSchema,
  presenceMessageSchema,
  reconciledMessageSchema,
  conflictMessageSchema,
  errorMessageSchema,
  eventMessageSchema,
]);

export type CollaborationClientMessage = z.infer<
  typeof collaborationClientMessageSchema
>;
export type CollaborationServerMessage = z.infer<
  typeof collaborationServerMessageSchema
>;
export type CollaborationUser = z.infer<typeof collaborationUserSchema>;
export type CollaborationPresenceEntry = z.infer<
  typeof collaborationPresenceEntrySchema
>;

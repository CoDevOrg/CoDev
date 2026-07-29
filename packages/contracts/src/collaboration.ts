import { z } from "zod";

import { identifierSchema, timestampSchema } from "./domain";

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

const joinMessageSchema = z
  .object({
    type: z.literal("join"),
    worktreeId: identifierSchema.optional(),
    resumeFrom: z.string().min(1).max(128).optional(),
  })
  .strict();

const subscribeMessageSchema = z
  .object({
    type: z.literal("subscribe"),
    path: collaborationPathSchema,
    stateVector: yjsUpdateBase64Schema.optional(),
  })
  .strict();

const updateMessageSchema = z
  .object({
    type: z.literal("update"),
    path: collaborationPathSchema,
    update: yjsUpdateBase64Schema,
  })
  .strict();

const awarenessMessageSchema = z
  .object({
    type: z.literal("awareness"),
    path: collaborationPathSchema,
    update: yjsUpdateBase64Schema,
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
  path: collaborationPathSchema,
  update: yjsUpdateBase64Schema,
  revision: z.string().min(1),
  actorId: identifierSchema,
  streamId: z.string().min(1),
});

const serverAwarenessMessageSchema = awarenessMessageSchema.extend({
  actorId: identifierSchema,
  connectionId: z.string().min(1),
  streamId: z.string().min(1),
});

export const collaborationPresenceEntrySchema = z.object({
  connectionId: z.string().min(1),
  user: collaborationUserSchema,
  path: collaborationPathSchema.nullable(),
  lastSeenAt: timestampSchema,
});

const presenceMessageSchema = z.object({
  type: z.literal("presence"),
  members: z.array(collaborationPresenceEntrySchema).max(100),
});

const reconciledMessageSchema = z.object({
  type: z.literal("reconciled"),
  path: collaborationPathSchema,
  revision: z.string().min(1),
  source: z.enum(["collaboration", "filesystem"]),
  update: yjsUpdateBase64Schema.optional(),
});

const conflictMessageSchema = z.object({
  type: z.literal("conflict"),
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

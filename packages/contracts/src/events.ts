import { z } from "zod";

import {
  agentSessionSchema,
  identifierSchema,
  timestampSchema,
} from "./domain";
import { collaborationPathSchema } from "./collaboration";

const eventBaseSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  sequence: z.number().int().nonnegative(),
  createdAt: timestampSchema,
});

const sharedSessionEventBaseSchema = eventBaseSchema.extend({
  sessionId: identifierSchema,
});

const sharedSessionEventOptions = [
  sharedSessionEventBaseSchema.extend({
    type: z.literal("shared_session.created"),
    data: z.object({
      ownerId: identifierSchema,
      worktreeId: identifierSchema,
      provider: z.string().min(1).max(64),
      model: z.string().min(1).max(128),
    }),
  }),
  sharedSessionEventBaseSchema.extend({
    type: z.literal("shared_session.turn.queued"),
    data: z.object({
      turnId: identifierSchema,
      authorId: identifierSchema,
      prompt: z.string().min(1).max(50_000),
      queuePosition: z.number().int().positive(),
    }),
  }),
  sharedSessionEventBaseSchema.extend({
    type: z.literal("shared_session.turn.started"),
    data: z.object({
      turnId: identifierSchema,
      queuePosition: z.number().int().positive(),
    }),
  }),
  sharedSessionEventBaseSchema.extend({
    type: z.literal("shared_session.turn.completed"),
    data: z.object({
      turnId: identifierSchema,
      queuePosition: z.number().int().positive(),
      output: z.string(),
    }),
  }),
  sharedSessionEventBaseSchema.extend({
    type: z.literal("shared_session.turn.interrupted"),
    data: z.object({
      turnId: identifierSchema,
      queuePosition: z.number().int().positive(),
      reason: z.string().min(1).max(2_000),
    }),
  }),
  sharedSessionEventBaseSchema.extend({
    type: z.literal("shared_session.turn.failed"),
    data: z.object({
      turnId: identifierSchema,
      queuePosition: z.number().int().positive(),
      error: z.string().min(1).max(2_000),
    }),
  }),
] as const;

export const sharedSessionEventSchema = z.discriminatedUnion(
  "type",
  sharedSessionEventOptions,
);

export const presenceCursorSchema = z
  .object({
    anchor: z.number().int().nonnegative(),
    head: z.number().int().nonnegative(),
  })
  .strict();

const presenceEventOptions = [
  eventBaseSchema.extend({
    type: z.literal("presence.joined"),
    data: z.object({
      userId: identifierSchema,
      worktreeId: identifierSchema.nullable(),
      activePath: collaborationPathSchema.nullable(),
      cursor: presenceCursorSchema.nullable(),
    }),
  }),
  eventBaseSchema.extend({
    type: z.literal("presence.left"),
    data: z.object({
      userId: identifierSchema,
      worktreeId: identifierSchema.nullable(),
      activePath: collaborationPathSchema.nullable(),
      cursor: presenceCursorSchema.nullable(),
      reason: z.enum(["disconnect", "leave", "timeout"]),
    }),
  }),
  eventBaseSchema.extend({
    type: z.literal("presence.active_file.changed"),
    data: z.object({
      userId: identifierSchema,
      path: collaborationPathSchema,
      previousPath: collaborationPathSchema.nullable(),
    }),
  }),
  eventBaseSchema.extend({
    type: z.literal("presence.cursor.changed"),
    data: z.object({
      userId: identifierSchema,
      path: collaborationPathSchema,
      cursor: presenceCursorSchema,
    }),
  }),
] as const;

export const presenceEventSchema = z.discriminatedUnion(
  "type",
  presenceEventOptions,
);

export const workspaceEventSchema = z.discriminatedUnion("type", [
  ...presenceEventOptions,
  ...sharedSessionEventOptions,
  eventBaseSchema.extend({
    type: z.literal("presence.changed"),
    data: z.object({
      userId: identifierSchema,
      state: z.enum(["online", "away", "offline"]),
      activePath: z.string().nullable(),
      worktreeId: identifierSchema.nullable(),
    }),
  }),
  eventBaseSchema.extend({
    type: z.literal("agent.session.changed"),
    data: agentSessionSchema,
  }),
  eventBaseSchema.extend({
    type: z.literal("agent.output"),
    data: z.object({
      sessionId: identifierSchema,
      turnId: identifierSchema,
      channel: z.enum(["message", "tool", "status", "error"]),
      content: z.string(),
    }),
  }),
  eventBaseSchema.extend({
    type: z.literal("claim.changed"),
    data: z.object({
      claimId: identifierSchema,
      sessionId: identifierSchema,
      pathGlob: z.string(),
      status: z.enum(["active", "released", "expired", "contested"]),
    }),
  }),
  eventBaseSchema.extend({
    type: z.literal("filesystem.changed"),
    data: z.object({
      worktreeId: identifierSchema,
      path: z.string().min(1),
      revision: z.string().min(1),
      actorId: identifierSchema.nullable(),
    }),
  }),
]);

export type WorkspaceEvent = z.infer<typeof workspaceEventSchema>;
export type PresenceEvent = z.infer<typeof presenceEventSchema>;
export type SharedSessionEvent = z.infer<typeof sharedSessionEventSchema>;

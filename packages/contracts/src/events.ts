import { z } from "zod";

import {
  agentSessionSchema,
  identifierSchema,
  timestampSchema,
} from "./domain";

const eventBaseSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  sequence: z.number().int().nonnegative(),
  createdAt: timestampSchema,
});

export const workspaceEventSchema = z.discriminatedUnion("type", [
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

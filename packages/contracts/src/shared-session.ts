import { z } from "zod";

import {
  agentSessionStatusSchema,
  identifierSchema,
  timestampSchema,
} from "./domain";

export const sharedSessionQueueEntrySchema = z.object({
  id: identifierSchema,
  sessionId: identifierSchema,
  authorId: identifierSchema,
  prompt: z.string().min(1).max(50_000),
  queuePosition: z.number().int().positive(),
  enqueuedAt: timestampSchema,
});

export const enqueueSharedSessionTurnInputSchema = z.object({
  id: identifierSchema,
  sessionId: identifierSchema,
  authorId: identifierSchema,
  prompt: z.string().min(1).max(50_000),
  enqueuedAt: timestampSchema,
});

export const sharedSessionSchema = z.object({
  sessionId: identifierSchema,
  workspaceId: identifierSchema,
  ownerId: identifierSchema,
  worktreeId: identifierSchema,
  provider: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(128),
  state: agentSessionStatusSchema,
  activeTurnId: identifierSchema.nullable(),
  streamCursor: z.number().int().nonnegative(),
  queue: z.array(sharedSessionQueueEntrySchema).max(100),
});

export type SharedSessionQueueEntry = z.infer<
  typeof sharedSessionQueueEntrySchema
>;
export type EnqueueSharedSessionTurnInput = z.infer<
  typeof enqueueSharedSessionTurnInputSchema
>;
export type SharedSession = z.infer<typeof sharedSessionSchema>;

/**
 * Sort a persisted queue by its durable position, with stable tie-breakers
 * for repairing legacy rows that were written without unique positions.
 */
export function orderSharedSessionQueue(
  queue: readonly SharedSessionQueueEntry[],
) {
  return [...sharedSessionQueueEntrySchema.array().parse(queue)].sort(
    (left, right) =>
      left.queuePosition - right.queuePosition ||
      left.enqueuedAt.localeCompare(right.enqueuedAt) ||
      left.id.localeCompare(right.id),
  );
}

/**
 * Assign the next position from the persisted queue rather than from a
 * client-provided counter. The caller can persist the returned entry and
 * broadcast the same position to every session member.
 */
export function enqueueSharedSessionTurn(
  queue: readonly SharedSessionQueueEntry[],
  input: EnqueueSharedSessionTurnInput,
) {
  const parsedQueue = sharedSessionQueueEntrySchema.array().parse(queue);
  const nextPosition =
    parsedQueue.reduce(
      (highest, entry) => Math.max(highest, entry.queuePosition),
      0,
    ) + 1;
  const entry = sharedSessionQueueEntrySchema.parse({
    ...enqueueSharedSessionTurnInputSchema.parse(input),
    queuePosition: nextPosition,
  });

  return { entry, queue: orderSharedSessionQueue([...parsedQueue, entry]) };
}

import { z } from "zod";

import { gen2SupersetWorktreeIdSchema } from "./gen2";

/** What the guest host reports for worktrees CoDev asks it to compare. */
export const gen2CoordinationReportSchema = z.object({
  worktrees: z.array(
    z.object({
      worktreeId: gen2SupersetWorktreeIdSchema,
      state: z.enum(["known", "large", "unavailable"]),
    }),
  ),
  overlaps: z.array(
    z.object({
      worktreeIds: z.tuple([
        gen2SupersetWorktreeIdSchema,
        gen2SupersetWorktreeIdSchema,
      ]),
      path: z.string().min(1).max(1024),
      level: z.enum(["file", "function"]),
      symbols: z.array(z.string().max(80)).max(500),
    }),
  ),
  truncated: z.boolean(),
});

/** One active agent session's overlap with another, as members see it. */
export const gen2AgentOverlapSchema = z.object({
  runId: z.string().uuid(),
  otherRunId: z.string().uuid(),
  otherWorktreeId: gen2SupersetWorktreeIdSchema,
  otherProvider: z.string(),
  otherCreatedBy: z.string().uuid(),
  path: z.string().min(1).max(1024),
  level: z.enum(["file", "function"]),
  symbols: z.array(z.string().max(80)),
});

export const gen2AgentOverlapListResponseSchema = z.object({
  overlaps: z.array(gen2AgentOverlapSchema),
  /** Worktrees whose changes could not be compared; their overlaps are unknown, not absent. */
  unavailableWorktreeIds: z.array(gen2SupersetWorktreeIdSchema),
});

/** An active session whose task looks like the one being started. */
export const gen2PossibleDuplicateTaskSchema = z.object({
  runId: z.string().uuid(),
  worktreeId: gen2SupersetWorktreeIdSchema,
  provider: z.string(),
  createdBy: z.string().uuid(),
  status: z.string(),
  task: z.string().max(500),
});

export const gen2AgentStartPossibleDuplicateResponseSchema = z.object({
  possibleDuplicate: gen2PossibleDuplicateTaskSchema,
});

export type Gen2CoordinationReport = z.infer<
  typeof gen2CoordinationReportSchema
>;
export type Gen2AgentOverlap = z.infer<typeof gen2AgentOverlapSchema>;
export type Gen2AgentOverlapListResponse = z.infer<
  typeof gen2AgentOverlapListResponseSchema
>;
export type Gen2PossibleDuplicateTask = z.infer<
  typeof gen2PossibleDuplicateTaskSchema
>;

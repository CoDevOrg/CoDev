import { z } from "zod";

import { claimPathSchema, identifierSchema, timestampSchema } from "./domain";

/**
 * The workspace brain gives every agent — and the people watching them — one
 * shared, queryable picture of what each session is trying to do, what has
 * already been tried, and where two sessions are about to collide. These
 * schemas are the contract between the agent tools, the API routes, and
 * Mission Control.
 */

export const BRIEF_GOAL_MAX = 2_000;
export const BRIEF_SUMMARY_MAX = 4_000;
export const BRIEF_STEP_MAX = 400;
export const BRIEF_PLAN_STEPS_MAX = 24;
export const BRIEF_FILES_MAX = 60;

export const BRAIN_ENTRY_TITLE_MAX = 200;
export const BRAIN_ENTRY_BODY_MAX = 10_000;
export const BRAIN_ENTRY_PATHS_MAX = 60;
export const BRAIN_SEARCH_QUERY_MAX = 500;

export const agentBriefStatusSchema = z.enum([
  "planning",
  "active",
  "blocked",
  "paused",
  "done",
]);

export const briefPlanStepSchema = z.object({
  label: z.string().trim().min(1).max(BRIEF_STEP_MAX),
  state: z.enum(["done", "active", "pending"]),
});

/**
 * A partial update: an agent posts its goal once, then keeps `currentStep`
 * and `status` fresh as it works. Every field is optional so a call can move
 * just one part of the brief.
 */
export const updateAgentBriefSchema = z
  .object({
    goal: z.string().trim().max(BRIEF_GOAL_MAX).optional(),
    approachSummary: z.string().trim().max(BRIEF_SUMMARY_MAX).optional(),
    planSteps: z
      .array(briefPlanStepSchema)
      .max(BRIEF_PLAN_STEPS_MAX)
      .optional(),
    currentStep: z.string().trim().max(BRIEF_STEP_MAX).optional(),
    filesLikelyToTouch: z
      .array(claimPathSchema)
      .max(BRIEF_FILES_MAX)
      .optional(),
    status: agentBriefStatusSchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "Provide at least one field to update.",
  );

export const agentBriefSchema = z.object({
  sessionId: identifierSchema,
  workspaceId: identifierSchema,
  goal: z.string(),
  approachSummary: z.string(),
  planSteps: z.array(briefPlanStepSchema),
  currentStep: z.string(),
  filesLikelyToTouch: z.array(z.string()),
  keywords: z.array(z.string()),
  status: agentBriefStatusSchema,
  updatedAt: timestampSchema,
});

export const brainEntryKindSchema = z.enum([
  "decision",
  "attempt",
  "dead_end",
  "finding",
  "convention",
  "handoff",
]);

export const recordBrainEntrySchema = z.object({
  kind: brainEntryKindSchema,
  title: z.string().trim().min(1).max(BRAIN_ENTRY_TITLE_MAX),
  body: z.string().trim().max(BRAIN_ENTRY_BODY_MAX).default(""),
  paths: z.array(claimPathSchema).max(BRAIN_ENTRY_PATHS_MAX).default([]),
  supersedesId: identifierSchema.optional(),
});

export const brainEntrySchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  sessionId: identifierSchema.nullable(),
  authorId: identifierSchema.nullable(),
  authorName: z.string().nullable(),
  kind: brainEntryKindSchema,
  title: z.string(),
  body: z.string(),
  paths: z.array(z.string()),
  keywords: z.array(z.string()),
  supersedesId: identifierSchema.nullable(),
  createdAt: timestampSchema,
});

export const brainOverlapKindSchema = z.enum([
  "duplicate_intent",
  "file_overlap",
  "claim_contest",
]);

export const brainOverlapStatusSchema = z.enum([
  "open",
  "acknowledged",
  "resolved",
]);

export const brainOverlapSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  leftSessionId: identifierSchema,
  rightSessionId: identifierSchema,
  kind: brainOverlapKindSchema,
  score: z.number(),
  evidence: z.record(z.string(), z.unknown()),
  rationale: z.string(),
  status: brainOverlapStatusSchema,
  detectedAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const updateBrainOverlapSchema = z.object({
  status: brainOverlapStatusSchema,
});

export const brainSearchQuerySchema = z.object({
  query: z.string().trim().min(1).max(BRAIN_SEARCH_QUERY_MAX),
  limit: z.number().int().min(1).max(25).default(8),
});

export type AgentBriefStatus = z.infer<typeof agentBriefStatusSchema>;
export type BriefPlanStep = z.infer<typeof briefPlanStepSchema>;
export type UpdateAgentBrief = z.infer<typeof updateAgentBriefSchema>;
export type AgentBrief = z.infer<typeof agentBriefSchema>;
export type BrainEntryKind = z.infer<typeof brainEntryKindSchema>;
export type RecordBrainEntry = z.infer<typeof recordBrainEntrySchema>;
export type BrainEntry = z.infer<typeof brainEntrySchema>;
export type BrainOverlapKind = z.infer<typeof brainOverlapKindSchema>;
export type BrainOverlapStatus = z.infer<typeof brainOverlapStatusSchema>;
export type BrainOverlap = z.infer<typeof brainOverlapSchema>;
export type UpdateBrainOverlap = z.infer<typeof updateBrainOverlapSchema>;
export type BrainSearchQuery = z.infer<typeof brainSearchQuerySchema>;

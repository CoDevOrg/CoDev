import { z } from "zod";

export const identifierSchema = z.uuid();
export const timestampSchema = z.iso.datetime();

/** The maximum number of active agent worktrees a workspace may reserve. */
export const MAX_PARALLEL_AGENT_SESSIONS = 3;

export const agentCapacitySchema = z.object({
  maxActiveSessions: z.literal(MAX_PARALLEL_AGENT_SESSIONS),
  activeSessions: z.number().int().nonnegative(),
  availableSlots: z.number().int().min(0).max(MAX_PARALLEL_AGENT_SESSIONS),
});

export const workspaceStatusSchema = z.enum([
  "pending",
  "provisioning",
  "ready",
  "hibernated",
  "stopping",
  "stopped",
  "failed",
]);

export const userSchema = z.object({
  id: identifierSchema,
  githubUserId: z.string().min(1).nullable(),
  login: z.string().min(1),
  avatarUrl: z.url().nullable(),
});

export const memberCapabilitiesSchema = z.object({
  canTerminal: z.boolean(),
  canMerge: z.boolean(),
});

/**
 * The product-facing workspace roles. Database/OpenFGA access-role names may
 * remain more specific for compatibility, but every member is presented with
 * one of these three capability sets.
 */
export const workspaceRoleSchema = z.enum([
  "viewer",
  "collaborator",
  "maintainer",
]);

export const workspaceRoleCapabilitiesSchema = z.object({
  role: workspaceRoleSchema,
  canView: z.literal(true),
  canEdit: z.boolean(),
  canCoSteer: z.boolean(),
  canInspectDiffs: z.literal(true),
  canUseTerminal: z.boolean(),
  canWriteTerminal: z.boolean(),
  canManageMembers: z.boolean(),
  canApproveIntegration: z.boolean(),
});

export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type WorkspaceRoleCapabilities = z.infer<
  typeof workspaceRoleCapabilitiesSchema
>;

export const workspaceRoleCapabilities = {
  viewer: {
    role: "viewer",
    canView: true,
    canEdit: false,
    canCoSteer: false,
    canInspectDiffs: true,
    canUseTerminal: false,
    canWriteTerminal: false,
    canManageMembers: false,
    canApproveIntegration: false,
  },
  collaborator: {
    role: "collaborator",
    canView: true,
    canEdit: true,
    canCoSteer: true,
    canInspectDiffs: true,
    canUseTerminal: true,
    canWriteTerminal: true,
    canManageMembers: false,
    canApproveIntegration: false,
  },
  maintainer: {
    role: "maintainer",
    canView: true,
    canEdit: true,
    canCoSteer: true,
    canInspectDiffs: true,
    canUseTerminal: true,
    canWriteTerminal: true,
    canManageMembers: true,
    canApproveIntegration: true,
  },
} as const satisfies Record<WorkspaceRole, WorkspaceRoleCapabilities>;

export const workspaceMemberSchema = z.object({
  workspaceId: identifierSchema,
  userId: identifierSchema,
  role: z.enum(["owner", "member"]),
  capabilities: memberCapabilitiesSchema,
  accessRole: z.enum(["owner", "co_steer", "reviewer", "viewer"]).optional(),
  joinedAt: timestampSchema,
});

export const workspaceSchema = z.object({
  id: identifierSchema,
  ownerId: identifierSchema,
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  repositoryVisibility: z.enum(["public", "private"]),
  baseSha: z.string().regex(/^[0-9a-f]{40}$/),
  status: workspaceStatusSchema,
  lastActivityAt: timestampSchema,
  expiresAt: timestampSchema,
});

export const sandboxInstanceSchema = z.object({
  id: z.string().min(1),
  workspaceId: identifierSchema,
  status: z.enum([
    "provisioning",
    "ready",
    "hibernated",
    "stopping",
    "stopped",
    "failed",
  ]),
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  createdAt: timestampSchema,
  lastActivityAt: timestampSchema,
  expiresAt: timestampSchema,
});

export const worktreeSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  kind: z.enum(["integration", "agent"]),
  name: z.string().min(1),
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  status: z.enum(["active", "frozen", "merged", "discarded"]),
});

export const agentSessionStatusSchema = z.enum([
  "idle",
  "running",
  "waiting",
  "completed",
  "interrupted",
  "failed",
]);

export const agentSessionSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  worktreeId: identifierSchema,
  createdBy: identifierSchema,
  issueNumber: z.number().int().positive().nullable(),
  issueTitle: z.string().min(1).max(1_000).nullable(),
  issueUrl: z.url().nullable(),
  name: z.string().min(1).max(32),
  model: z.string().min(1),
  status: agentSessionStatusSchema,
  workflowRunId: z.string().nullable(),
  lastError: z.string().nullable(),
  interruptedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

export const agentTurnSchema = z.object({
  id: identifierSchema,
  sessionId: identifierSchema,
  authorId: identifierSchema,
  prompt: z.string().min(1).max(50_000),
  status: z.enum(["queued", "running", "completed", "interrupted", "failed"]),
  workflowRunId: z.string().nullable(),
  responseId: z.string().nullable(),
  output: z.string().nullable(),
  lastError: z.string().nullable(),
  startedAt: timestampSchema.nullable(),
  finishedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

export const agentActivityEventSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  sessionId: identifierSchema,
  turnId: identifierSchema,
  type: z.enum([
    "turn.started",
    "agent.output",
    "tool.called",
    "tool.completed",
    "tool.failed",
    "turn.completed",
  ]),
  payload: z.record(z.string(), z.unknown()),
  createdAt: timestampSchema,
});

export const pathClaimSchema = z.object({
  id: identifierSchema,
  sessionId: identifierSchema,
  pathGlob: z.string().min(1),
  intent: z.string().min(1).max(2_000),
  revision: z.string().min(1),
  status: z.enum(["active", "released", "expired", "contested"]),
  expiresAt: timestampSchema,
});

export const claimPathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\0") &&
      !path.split("/").some((part) => part === "." || part === "..") &&
      (!path.includes("*") ||
        (path.endsWith("/**") && !path.slice(0, -3).includes("*"))),
    "Claims must be an exact relative path or a directory/** pattern.",
  );

export const createPathClaimSchema = z.object({
  path: claimPathSchema,
  intent: z.string().trim().min(1).max(2_000),
  revision: z.string().min(1).max(255),
  ttlSeconds: z.number().int().min(30).max(3_600).default(900),
  contest: z.boolean().default(false),
});

const claimRequestPayloadSchema = z.object({
  claimId: identifierSchema,
  path: claimPathSchema,
  intent: z.string().min(1).max(2_000),
});
const claimResponsePayloadSchema = z.object({
  claimId: identifierSchema,
  decision: z.enum(["accept", "reject", "counter"]),
  reason: z.string().min(1).max(2_000).optional(),
  proposedPath: claimPathSchema.optional(),
});
const handoffPayloadSchema = z.object({
  paths: z.array(claimPathSchema).min(1).max(100),
  summary: z.string().min(1).max(10_000),
  revision: z.string().min(1).max(255).optional(),
});
const notePayloadSchema = z.object({
  body: z.string().min(1).max(10_000),
});

export const coordinationMessageInputSchema = z.discriminatedUnion("kind", [
  z.object({
    toSessionId: identifierSchema,
    kind: z.literal("claim_request"),
    payload: claimRequestPayloadSchema,
    correlationId: identifierSchema.optional(),
    responseToId: identifierSchema.optional(),
  }),
  z.object({
    toSessionId: identifierSchema,
    kind: z.literal("claim_response"),
    payload: claimResponsePayloadSchema,
    correlationId: identifierSchema,
    responseToId: identifierSchema,
  }),
  z.object({
    toSessionId: identifierSchema,
    kind: z.literal("handoff"),
    payload: handoffPayloadSchema,
    correlationId: identifierSchema.optional(),
    responseToId: identifierSchema.optional(),
  }),
  z.object({
    toSessionId: identifierSchema,
    kind: z.literal("note"),
    payload: notePayloadSchema,
    correlationId: identifierSchema.optional(),
    responseToId: identifierSchema.optional(),
  }),
]);

export const coordinationMessageSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  fromSessionId: identifierSchema,
  toSessionId: identifierSchema,
  kind: z.enum(["claim_request", "claim_response", "handoff", "note"]),
  payload: z.record(z.string(), z.unknown()),
  correlationId: identifierSchema,
  responseToId: identifierSchema.nullable(),
  status: z.enum(["pending", "delivered", "resolved"]),
  createdAt: timestampSchema,
});

export const conflictReportInputSchema = z.object({
  worktreeId: identifierSchema.optional(),
  path: claimPathSchema,
  collaborativeContents: z.string().max(2 * 1_024 * 1_024),
});

export const conflictResolutionInputSchema = z
  .object({
    worktreeId: identifierSchema.optional(),
    path: claimPathSchema,
    strategy: z.enum(["collaboration", "filesystem", "merged"]),
    expectedSnapshotRevision: z.string().min(1).max(255),
    expectedFilesystemRevision: z.string().min(1).max(255),
    mergedContents: z
      .string()
      .max(2 * 1_024 * 1_024)
      .optional(),
  })
  .superRefine((input, context) => {
    if (input.strategy === "merged" && input.mergedContents === undefined) {
      context.addIssue({
        code: "custom",
        path: ["mergedContents"],
        message: "Merged contents are required for the merged strategy.",
      });
    }
    if (input.strategy !== "merged" && input.mergedContents !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["mergedContents"],
        message: "Merged contents are only valid for the merged strategy.",
      });
    }
  });

export const publicationBranchNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^codev\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)*$/,
    "Publication branches must start with codev/ and contain safe lowercase Git ref segments.",
  )
  .refine(
    (branch) =>
      !branch.includes("..") &&
      !branch.includes("@{") &&
      !branch.endsWith(".lock") &&
      !branch.split("/").some((segment) => segment.startsWith(".")),
    "Invalid Git reference.",
  );

export const createPublicationSchema = z.object({
  branchName: publicationBranchNameSchema,
  expectedHeadSha: z.string().regex(/^[0-9a-f]{40}$/),
});

export const createPullRequestSchema = z.object({
  branchName: publicationBranchNameSchema,
  title: z.string().trim().min(1).max(256),
  body: z.string().trim().max(10_000).optional(),
});

export const workspacePullRequestSchema = z.object({
  number: z.number().int().positive(),
  htmlUrl: z.url(),
  state: z.enum(["open", "closed"]),
});

export const designPartnerFeedbackInputSchema = z.object({
  category: z.enum(["bug", "workflow", "feature", "other"]),
  rating: z.number().int().min(1).max(5).nullable(),
  message: z.string().trim().min(10).max(2_000),
  page: z.string().trim().max(200).nullable(),
  workspaceId: identifierSchema.nullable(),
});

export const environmentVariableNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, {
    message: "Use letters, numbers, and underscores.",
  })
  .min(1)
  .max(128);

export const environmentVariableValueSchema = z.string().min(1).max(8_192);

export const createEnvironmentVariableSchema = z.object({
  name: environmentVariableNameSchema,
  value: environmentVariableValueSchema,
});

export const updateEnvironmentVariableSchema = z.object({
  value: environmentVariableValueSchema,
});

export const environmentVariableSchema = z.object({
  id: identifierSchema,
  name: environmentVariableNameSchema,
  lastFour: z.string().min(1).max(4).nullable(),
  updatedAt: timestampSchema,
  createdAt: timestampSchema,
});

export const publicationSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  branchName: publicationBranchNameSchema,
  status: z.enum(["pending", "published", "failed"]),
  sourceHeadSha: z.string().regex(/^[0-9a-f]{40}$/),
  baseSha: z.string().regex(/^[0-9a-f]{40}$/),
  commitSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullable(),
  htmlUrl: z.url().nullable(),
  lastError: z.string().nullable(),
  publishedAt: timestampSchema.nullable(),
  updatedAt: timestampSchema,
});

export type User = z.infer<typeof userSchema>;
export type AgentCapacity = z.infer<typeof agentCapacitySchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type SandboxInstance = z.infer<typeof sandboxInstanceSchema>;
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
export type Worktree = z.infer<typeof worktreeSchema>;
export type AgentSession = z.infer<typeof agentSessionSchema>;
export type AgentTurn = z.infer<typeof agentTurnSchema>;
export type AgentActivityEvent = z.infer<typeof agentActivityEventSchema>;
export type DesignPartnerFeedbackInput = z.infer<
  typeof designPartnerFeedbackInputSchema
>;
export type EnvironmentVariable = z.infer<typeof environmentVariableSchema>;
export type CreateEnvironmentVariable = z.infer<
  typeof createEnvironmentVariableSchema
>;
export type UpdateEnvironmentVariable = z.infer<
  typeof updateEnvironmentVariableSchema
>;
export type PathClaim = z.infer<typeof pathClaimSchema>;
export type CoordinationMessage = z.infer<typeof coordinationMessageSchema>;
export type CoordinationMessageInput = z.infer<
  typeof coordinationMessageInputSchema
>;
export type ConflictReportInput = z.infer<typeof conflictReportInputSchema>;
export type ConflictResolutionInput = z.infer<
  typeof conflictResolutionInputSchema
>;
export type Publication = z.infer<typeof publicationSchema>;
export type CreatePullRequest = z.infer<typeof createPullRequestSchema>;
export type WorkspacePullRequest = z.infer<typeof workspacePullRequestSchema>;

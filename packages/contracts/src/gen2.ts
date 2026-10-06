import { z } from "zod";

import { identifierSchema, timestampSchema } from "./domain";

export const gen2WorkspaceStatusSchema = z.enum([
  "pending",
  "provisioning",
  "ready",
  "failed",
  "stopped",
  "deleting",
]);

export const gen2RuntimeProviderSchema = z.enum(["firecracker", "azure_arm"]);
export const gen2RuntimeStatusSchema = z.enum([
  "stopped",
  "queued",
  "provisioning",
  "booting",
  "attaching_disk",
  "starting_tunnel",
  "checking_readiness",
  "ready",
  "stopping",
  "failed",
]);
export const gen2RuntimeOperationKindSchema = z.enum([
  "start",
  "stop",
  "delete",
]);
export const gen2RuntimeOperationRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(128),
});
export const gen2RuntimeOperationResponseSchema = z.object({
  accepted: z.literal(true),
  operationId: identifierSchema.nullable(),
  workspace: z.lazy(() => gen2WorkspaceSchema),
});

export const gen2WorkspaceRoleSchema = z.enum(["owner", "editor", "viewer"]);

export const gen2WorkspaceCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    /** Both or neither: a repository is identified by its installation. */
    installationId: z.number().int().positive().optional(),
    repositoryId: z.number().int().positive().optional(),
    acknowledgeReducedQuota: z.boolean().optional(),
  })
  .refine(
    (input) =>
      (input.installationId === undefined) ===
      (input.repositoryId === undefined),
    "Provide an installation and a repository together, or neither.",
  );

export const gen2RepositorySchema = z.object({
  /** "owner/name", or null for a blank machine. */
  fullName: z.string().min(1),
  private: z.boolean(),
  defaultBranch: z.string().min(1),
});

export const gen2WorkspaceMemberSchema = z.object({
  userId: identifierSchema,
  login: z.string().min(1),
  name: z.string().nullable(),
  email: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  role: gen2WorkspaceRoleSchema,
  joinedAt: timestampSchema.optional(),
});

export const gen2WorkspaceSchema = z.object({
  id: identifierSchema,
  name: z.string().min(1).max(80),
  repository: gen2RepositorySchema.nullable().default(null),
  status: gen2WorkspaceStatusSchema,
  sandboxId: z.string().min(1).nullable(),
  runtimeProvider: gen2RuntimeProviderSchema.default("firecracker"),
  runtimeStatus: gen2RuntimeStatusSchema.default("stopped"),
  runtimeGeneration: z.number().int().nonnegative().default(0),
  lastError: z.string().nullable(),
  role: gen2WorkspaceRoleSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const gen2WorkspaceDetailSchema = gen2WorkspaceSchema.extend({
  members: z.array(gen2WorkspaceMemberSchema),
});

export const gen2ShareRequestSchema = z.object({
  role: gen2WorkspaceRoleSchema.optional().default("editor"),
});

export const gen2ShareResponseSchema = z.object({
  inviteUrl: z.url(),
  role: gen2WorkspaceRoleSchema.optional(),
});

export const gen2AddMemberRequestSchema = z.object({
  emailOrLogin: z.string().trim().min(1).max(256),
  role: gen2WorkspaceRoleSchema,
});

export const gen2UpdateMemberRoleRequestSchema = z.object({
  role: gen2WorkspaceRoleSchema,
});

export const gen2JoinRequestSchema = z.object({
  token: z.string().min(1),
});

/** The agents a Gen 2 turn can run, in the order the composer lists them.
 *  A registry test holds this list to the providers whose credentials the
 *  `gen2` executor can run, so it cannot drift from what settings shows. */
export const GEN2_AGENT_PROVIDERS = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude" },
  { id: "cursor", label: "Cursor" },
] as const;

export const gen2AgentProviderSchema = z.enum(
  GEN2_AGENT_PROVIDERS.map((provider) => provider.id) as [
    (typeof GEN2_AGENT_PROVIDERS)[number]["id"],
    ...(typeof GEN2_AGENT_PROVIDERS)[number]["id"][],
  ],
);

export const gen2ModelInfoSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

export type Gen2ModelInfo = z.infer<typeof gen2ModelInfoSchema>;
export const gen2AccountModelRequestSchema = z.object({
  userId: identifierSchema,
  provider: z.literal("codex"),
});
export const gen2AccountModelResponseSchema = z.object({
  models: z.array(gen2ModelInfoSchema).min(1),
});
export type Gen2ProviderStatus = {
  connected: boolean;
  via: "subscription" | "api-key" | null;
  models?: Gen2ModelInfo[];
  modelsError?: string;
};

export type Gen2ProviderModelId = string;

export const gen2AgentStartRequestSchema = z.object({
  chatId: identifierSchema,
  /** Which agent runs the turn. */
  provider: gen2AgentProviderSchema,
  prompt: z.string().trim().min(1).max(20_000),
  idempotencyKey: z.string().trim().min(8).max(128),
  /** Optional target worktree to execute in. */
  worktreeId: z.string().trim().min(1).max(128).optional(),
  /** Optional model override for the agent turn. */
  model: z.string().trim().min(1).max(128).optional(),
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
  /** Set on the poll that ends a turn: the reply the server persisted. */
  reply: z.string().nullable().default(null),
  persistedMessageId: identifierSchema.nullable().default(null),
});

export const gen2AgentCancelRequestSchema = z.object({
  sessionId: z.string().min(1).max(80),
});

export const gen2ChatAppendRequestSchema = z.object({
  body: z.string().trim().min(1).max(100_000),
});

export const gen2ChatRoleSchema = z.enum(["user", "assistant"]);

/**
 * One entry in a Codex turn, reduced from the `codex exec --json` NDJSON
 * stream. Every Codex item carries a stable `id` across
 * `item.started`/`item.updated`/`item.completed`, so reducing the whole
 * accumulated stream is idempotent and these ids are safe React keys.
 */
export const gen2TurnItemStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
]);

export const gen2FileChangeKindSchema = z.enum(["add", "modify", "delete"]);

const turnItemBase = {
  id: z.string().min(1).max(200),
  status: gen2TurnItemStatusSchema,
};

export const gen2TurnItemSchema = z.discriminatedUnion("kind", [
  z.object({
    ...turnItemBase,
    kind: z.literal("reasoning"),
    text: z.string(),
  }),
  z.object({
    ...turnItemBase,
    kind: z.literal("command"),
    command: z.string(),
    output: z.string(),
    exitCode: z.number().int().nullable(),
  }),
  z.object({
    ...turnItemBase,
    kind: z.literal("fileChange"),
    changes: z.array(
      z.object({ path: z.string().min(1), change: gen2FileChangeKindSchema }),
    ),
  }),
  z.object({
    ...turnItemBase,
    kind: z.literal("todoList"),
    todos: z.array(z.object({ text: z.string(), completed: z.boolean() })),
  }),
  z.object({
    ...turnItemBase,
    kind: z.literal("message"),
    text: z.string(),
  }),
  z.object({
    ...turnItemBase,
    kind: z.literal("webSearch"),
    query: z.string(),
  }),
  z.object({
    ...turnItemBase,
    kind: z.literal("toolCall"),
    server: z.string(),
    tool: z.string(),
  }),
]);

export const gen2TurnUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

export const gen2TurnStatusSchema = z.enum(["running", "completed", "failed"]);

export const gen2TurnStateSchema = z.object({
  items: z.array(gen2TurnItemSchema),
  reply: z.string(),
  error: z.string().nullable(),
  usage: gen2TurnUsageSchema.nullable(),
  status: gen2TurnStatusSchema,
});

export const gen2ChatMessageSchema = z.object({
  id: identifierSchema,
  role: gen2ChatRoleSchema,
  body: z.string().min(1),
  /** Activity cards for an assistant message; null for user messages. */
  items: z.array(gen2TurnItemSchema).nullable().default(null),
  createdAt: timestampSchema,
});

export const gen2ChatSchema = z.object({
  id: identifierSchema,
  title: z.string().min(1).max(80),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  messageCount: z.number().int().nonnegative().optional(),
});

export const gen2RenameChatRequestSchema = z.object({
  title: z.string().trim().min(1).max(80),
});

export const gen2ChatDetailSchema = gen2ChatSchema.extend({
  messages: z.array(gen2ChatMessageSchema),
});

/* ------------------------------------------------------------------ *
 * Workbench: files, git, and terminal on the workspace's own machine.
 *
 * These address the same Firecracker guest Codex runs in, so the file a
 * member opens here is the file the agent just edited. Paths are relative
 * to the guest's /workspace.
 * ------------------------------------------------------------------ */

export const gen2FilePathSchema = z.string().min(1).max(4_096);

export const gen2FileEntrySchema = z.object({
  path: gen2FilePathSchema,
  /** Git porcelain status (`M`, `??`, …), or null when unchanged. */
  status: z.string().min(1).max(2).nullable(),
});

export const gen2FileListResponseSchema = z.object({
  files: z.array(gen2FileEntrySchema),
});

export const gen2FileSearchMatchSchema = z.object({
  path: gen2FilePathSchema,
  line: z.number().int().positive(),
  preview: z.string(),
});

export const gen2FileSearchResponseSchema = z.object({
  matches: z.array(gen2FileSearchMatchSchema),
});

export const gen2FileReadRequestSchema = z.object({
  path: gen2FilePathSchema,
});

export const gen2FileSchema = z.object({
  path: gen2FilePathSchema,
  contents: z.string(),
  revision: z.string().min(1),
});

export const gen2FileReadResponseSchema = z.object({ file: gen2FileSchema });

export const gen2FileWriteRequestSchema = z.object({
  path: gen2FilePathSchema,
  contents: z.string().max(2 * 1_024 * 1_024),
  expectedRevision: z.string().min(1),
});

export const gen2FileWriteResponseSchema = z.object({
  revision: z.string().min(1),
});

export const gen2FileUploadRequestSchema = z.object({
  path: gen2FilePathSchema,
  contents: z.string().max(1_024 * 1_024),
  overwrite: z.boolean().default(false),
});

/*
 * Superset-derived file slice. These are separate from the existing Gen 2
 * guestd contracts because the Superset host selects an explicit worktree and
 * reports external host-side changes onto the shared document stream.
 */
/** Matches the guest's safe worktree directory identifier. */
export const gen2SupersetWorktreeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

export const gen2SupersetFileEntrySchema = z.object({
  path: gen2FilePathSchema,
  kind: z.literal("file"),
  size: z.number().int().nonnegative(),
});

export const gen2SupersetDirectoryEntrySchema = z.object({
  path: gen2FilePathSchema,
  kind: z.literal("directory"),
});

export const gen2SupersetEntrySchema = z.discriminatedUnion("kind", [
  gen2SupersetFileEntrySchema,
  gen2SupersetDirectoryEntrySchema,
]);

export const gen2SupersetFileSchema = gen2SupersetFileEntrySchema.extend({
  contents: z.string(),
  revision: z.string().min(1),
});

/** GET .../superset/files?worktreeId=:worktreeId */
export const gen2SupersetListFilesResponseSchema = z.object({
  files: z.array(gen2SupersetEntrySchema),
});

/** GET .../superset/file?worktreeId=:worktreeId&path=:path */
export const gen2SupersetReadFileResponseSchema = z.object({
  file: gen2SupersetFileSchema,
});

/** PUT .../superset/file */
export const gen2SupersetSaveFileRequestSchema = z.object({
  worktreeId: gen2SupersetWorktreeIdSchema,
  path: gen2FilePathSchema,
  contents: z.string().max(2 * 1_024 * 1_024),
  expectedRevision: z.string().min(1),
});

export const gen2SupersetSaveFileResponseSchema = z.object({
  file: gen2SupersetFileSchema,
});

const gen2SupersetRelativePathSchema = gen2FilePathSchema.refine(
  (value) =>
    !value
      .split("/")
      .some((part) => part.length === 0 || part === "." || part === ".."),
  "Path must stay within the selected worktree.",
);

const gen2SupersetParentPathSchema = z.union([
  z.literal(""),
  gen2SupersetRelativePathSchema,
]);

/** An entry is created atomically in the selected workspace folder. */
export const gen2SupersetCreateEntryRequestSchema = z.object({
  worktreeId: gen2SupersetWorktreeIdSchema,
  parentPath: gen2SupersetParentPathSchema.default(""),
  name: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(
      (value) =>
        value !== "." &&
        value !== ".." &&
        !value.includes("/") &&
        !value.includes("\\") &&
        !value.includes("\0") &&
        ![...value].some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        }),
      "Name must be a single file or folder name.",
    ),
  kind: z.enum(["file", "directory"]),
});

export const gen2SupersetCreateEntryResponseSchema = z.object({
  entry: gen2SupersetEntrySchema,
});

/** Move also covers a rename when the parent path is unchanged. */
export const gen2SupersetMoveEntryRequestSchema = z.object({
  worktreeId: gen2SupersetWorktreeIdSchema,
  path: gen2SupersetRelativePathSchema,
  parentPath: gen2SupersetParentPathSchema,
  name: gen2SupersetCreateEntryRequestSchema.shape.name,
});

export const gen2SupersetMoveEntryResponseSchema = z.object({
  entry: gen2SupersetEntrySchema,
});

export const gen2SupersetDeleteEntryRequestSchema = z.object({
  worktreeId: gen2SupersetWorktreeIdSchema,
  path: gen2SupersetRelativePathSchema,
});

export const gen2SupersetDeleteEntryResponseSchema = z.object({
  path: gen2SupersetRelativePathSchema,
});

/** A 409 save response carries the host's current revision. */
export const gen2SupersetSaveConflictResponseSchema = z.object({
  currentRevision: z.string().min(1),
});

export const gen2SupersetExternalFileChangeSchema = z.object({
  type: z.literal("file.changed"),
  worktreeId: gen2SupersetWorktreeIdSchema,
  path: gen2FilePathSchema,
  revision: z.string().min(1),
  origin: z.literal("external"),
});

export const gen2SupersetExternalFileChangesResponseSchema = z.object({
  changes: z.array(gen2SupersetExternalFileChangeSchema),
});

/** A branch checkout owned by the Superset host service. */
export const gen2SupersetWorktreeSchema = z.object({
  worktreeId: gen2SupersetWorktreeIdSchema,
  branch: z.string().min(1).max(255),
});

export const gen2SupersetWorktreeListResponseSchema = z.object({
  worktrees: z.array(gen2SupersetWorktreeSchema),
});

export const gen2SupersetWorktreeCreateRequestSchema = z.object({
  worktreeId: gen2SupersetWorktreeIdSchema.refine(
    (value) => value !== "main",
    "The primary worktree already exists.",
  ),
  branch: z
    .string()
    .min(1)
    .max(255)
    .refine(
      (value) =>
        !value.startsWith("-") &&
        !value.includes("..") &&
        !/[~^:?*[\\\s]/.test(value) &&
        !value.endsWith(".") &&
        !value.endsWith("/"),
      "Branch name is invalid.",
    ),
  baseRef: z.string().min(1).max(255).optional(),
});

export const gen2SupersetWorktreeCreateResponseSchema = z.object({
  worktree: gen2SupersetWorktreeSchema,
});

export const gen2GitOperationSchema = z.enum(["status", "diff", "show"]);

export const gen2GitResponseSchema = z.object({ output: z.string() });

/** The guest mints these; the shape is asserted before it reaches a route. */
export const gen2TerminalSessionIdSchema = z
  .string()
  .regex(/^term-\d+-\d+$/, "Invalid terminal session id.");

const gen2TerminalDimensions = {
  rows: z.number().int().min(1).max(500),
  columns: z.number().int().min(1).max(500),
};

const gen2TerminalWorktree = {
  worktreeId: gen2SupersetWorktreeIdSchema.default("main"),
};

export const gen2TerminalActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    ...gen2TerminalDimensions,
    ...gen2TerminalWorktree,
  }),
  z.object({
    action: z.literal("input"),
    sessionId: gen2TerminalSessionIdSchema,
    data: z.string().max(64 * 1_024),
    ...gen2TerminalWorktree,
  }),
  z.object({
    action: z.literal("resize"),
    sessionId: gen2TerminalSessionIdSchema,
    ...gen2TerminalDimensions,
    ...gen2TerminalWorktree,
  }),
  z.object({
    action: z.literal("poll"),
    sessionId: gen2TerminalSessionIdSchema,
    after: z.number().int().nonnegative(),
    ...gen2TerminalWorktree,
  }),
]);

export const gen2TerminalStartResponseSchema = z.object({
  sessionId: gen2TerminalSessionIdSchema,
});

export const gen2TerminalPollResponseSchema = z.object({
  chunks: z.array(
    z.object({
      sequence: z.number().int().nonnegative(),
      data: z.string(),
    }),
  ),
  nextSequence: z.number().int().nonnegative(),
  exited: z.boolean(),
  exitCode: z.number().int().nullable(),
});

/*
 * Superset agent-session mapping, per docs/SUPERSET_AGENT_SESSION_PLAN.md
 * Phase 1. This is the durable run row CoDev owns as the source of truth;
 * it is an internal/service-boundary shape, not what the browser receives --
 * a redacted view is defined when the browser integration (Phase 6) lands.
 * It never carries credential material, only a connection id and a
 * revision fingerprint.
 */
export const gen2SupersetRunStatusSchema = z.enum([
  "creating",
  "running",
  "stopping",
  "finished",
  "failed",
  "recovery_required",
]);

export const gen2AgentSessionFollowUpRequestSchema = z.object({
  data: z.string().trim().min(1).max(20_000),
});

export const gen2SupersetRunSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  chatId: identifierSchema.nullable(),
  createdBy: identifierSchema,
  worktreeId: gen2SupersetWorktreeIdSchema,
  hostWorkspaceId: z.string().min(1).nullable(),
  hostTerminalId: z.string().min(1).nullable(),
  hostAgentSessionId: z.string().min(1).nullable(),
  provider: z.string().min(1),
  connectionId: identifierSchema.nullable(),
  credentialRevision: z.string().min(1).nullable(),
  status: gen2SupersetRunStatusSchema,
  leaseClaimed: z.boolean(),
  exitReason: z.string().nullable(),
  recoveryCount: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1),
  lastError: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type Gen2SupersetRunStatus = z.infer<typeof gen2SupersetRunStatusSchema>;
export type Gen2SupersetRun = z.infer<typeof gen2SupersetRunSchema>;
export type Gen2AgentSessionFollowUpRequest = z.infer<
  typeof gen2AgentSessionFollowUpRequestSchema
>;

export type Gen2Repository = z.infer<typeof gen2RepositorySchema>;
export type Gen2WorkspaceStatus = z.infer<typeof gen2WorkspaceStatusSchema>;
export type Gen2RuntimeProvider = z.infer<typeof gen2RuntimeProviderSchema>;
export type Gen2RuntimeStatus = z.infer<typeof gen2RuntimeStatusSchema>;
export type Gen2RuntimeOperationKind = z.infer<
  typeof gen2RuntimeOperationKindSchema
>;
export type Gen2RuntimeOperationRequest = z.infer<
  typeof gen2RuntimeOperationRequestSchema
>;
export type Gen2RuntimeOperationResponse = z.infer<
  typeof gen2RuntimeOperationResponseSchema
>;
export type Gen2WorkspaceRole = z.infer<typeof gen2WorkspaceRoleSchema>;
export type Gen2Workspace = z.infer<typeof gen2WorkspaceSchema>;
export type Gen2WorkspaceDetail = z.infer<typeof gen2WorkspaceDetailSchema>;
export type Gen2WorkspaceMember = z.infer<typeof gen2WorkspaceMemberSchema>;
export type Gen2ShareRequest = z.infer<typeof gen2ShareRequestSchema>;
export type Gen2ShareResponse = z.infer<typeof gen2ShareResponseSchema>;
export type Gen2AddMemberRequest = z.infer<typeof gen2AddMemberRequestSchema>;
export type Gen2UpdateMemberRoleRequest = z.infer<
  typeof gen2UpdateMemberRoleRequestSchema
>;
export type Gen2AgentProviderName = z.infer<typeof gen2AgentProviderSchema>;
export type Gen2AgentStartRequest = z.infer<typeof gen2AgentStartRequestSchema>;
export type Gen2AgentPollResponse = z.infer<typeof gen2AgentPollResponseSchema>;
export type Gen2Chat = z.infer<typeof gen2ChatSchema>;
export type Gen2ChatMessage = z.infer<typeof gen2ChatMessageSchema>;
export type Gen2ChatDetail = z.infer<typeof gen2ChatDetailSchema>;
export type Gen2TurnItem = z.infer<typeof gen2TurnItemSchema>;
export type Gen2TurnItemStatus = z.infer<typeof gen2TurnItemStatusSchema>;
export type Gen2TurnState = z.infer<typeof gen2TurnStateSchema>;
export type Gen2TurnUsage = z.infer<typeof gen2TurnUsageSchema>;
export type Gen2FileEntry = z.infer<typeof gen2FileEntrySchema>;
export type Gen2FileSearchMatch = z.infer<typeof gen2FileSearchMatchSchema>;
export type Gen2File = z.infer<typeof gen2FileSchema>;
export type Gen2SupersetFileEntry = z.infer<typeof gen2SupersetFileEntrySchema>;
export type Gen2SupersetDirectoryEntry = z.infer<
  typeof gen2SupersetDirectoryEntrySchema
>;
export type Gen2SupersetEntry = z.infer<typeof gen2SupersetEntrySchema>;
export type Gen2SupersetFile = z.infer<typeof gen2SupersetFileSchema>;
export type Gen2SupersetSaveFileRequest = z.infer<
  typeof gen2SupersetSaveFileRequestSchema
>;
export type Gen2SupersetCreateEntryRequest = z.infer<
  typeof gen2SupersetCreateEntryRequestSchema
>;
export type Gen2SupersetExternalFileChange = z.infer<
  typeof gen2SupersetExternalFileChangeSchema
>;
export type Gen2SupersetWorktree = z.infer<typeof gen2SupersetWorktreeSchema>;
export type Gen2SupersetWorktreeCreateRequest = z.infer<
  typeof gen2SupersetWorktreeCreateRequestSchema
>;
export type Gen2GitOperation = z.infer<typeof gen2GitOperationSchema>;
export type Gen2TerminalAction = z.infer<typeof gen2TerminalActionSchema>;
export type Gen2TerminalPollResponse = z.infer<
  typeof gen2TerminalPollResponseSchema
>;

export const gen2OwnerBudgetReportSchema = z.object({
  currency: z.literal("USD"),
  complete: z.literal(true),
  ownerId: identifierSchema,
  month: z.string().datetime(),
  observedAt: z.string().datetime(),
  computeCents: z.number().int().nonnegative().max(2_147_483_647),
  storageCents: z.number().int().nonnegative().max(2_147_483_647),
  networkCents: z.number().int().nonnegative().max(2_147_483_647),
  operationsCents: z.number().int().nonnegative().max(2_147_483_647),
  otherCents: z.number().int().nonnegative().max(2_147_483_647),
  blocked: z.boolean().default(false),
});
export type Gen2OwnerBudgetReport = z.infer<typeof gen2OwnerBudgetReportSchema>;
export type Gen2OwnerComputeEntitlement = {
  tier: "free" | "paid";
  enabled: boolean;
  unlimited: boolean;
  ownedWorkspaceCount: number;
  monthlyLimitMs: number | null;
};

export const gen2ComputeSwitchRequestSchema = z.object({
  workspaceId: identifierSchema,
  activeWorkspaceId: identifierSchema,
  idempotencyKey: z.string().trim().min(1).max(128),
});

export type Gen2OwnerBudgetSummary = {
  spentCents: number | null;
  limitCents: number;
  observedAt: string | null;
  blocked: boolean;
};
export type Gen2OwnerComputeSummary = {
  minutesUsed: number;
  minutesLimit: number | null;
  unlimited: boolean;
  resetsAt: string;
  tier: "free" | "paid";
  freeEnabled: boolean;
  ownedWorkspaceCount: number;
  activeWorkspaceLimit: number | null;
  armBootMinutesCount: boolean;
  budget: Gen2OwnerBudgetSummary | null;
};
export type Gen2ComputeSwitchResponse = {
  accepted: boolean;
  workspaceId: string;
  stoppingWorkspaceId: string | null;
  operationId: string | null;
};

export const gen2ArmWorkflowParamsSchema = z.object({
  workspaceId: z.string().uuid(),
  operationId: z.string().uuid(),
  generation: z.number().int().nonnegative(),
  resourceGeneration: z.number().int().nonnegative(),
  cleanupGeneration: z.number().int().nonnegative().nullable(),
  kind: gen2RuntimeOperationKindSchema,
  checkpoints: z.record(z.string(), z.unknown()).optional(),
  activate: z.boolean().optional(),
  failureCode: z.string().max(128).optional(),
});
export type ArmWorkspaceWorkflowParams = z.infer<
  typeof gen2ArmWorkflowParamsSchema
>;

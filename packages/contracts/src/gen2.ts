import { z } from "zod";

import { identifierSchema, timestampSchema } from "./domain";

export const gen2WorkspaceStatusSchema = z.enum([
  "pending",
  "provisioning",
  "ready",
  "failed",
  "stopped",
]);

/**
 * Gen 2 workspace roles are permission presets. Server code authorizes
 * capabilities through `lib/policies`, rather than branching on these values.
 */
export const gen2WorkspaceRoleSchema = z.enum(["owner", "editor", "viewer"]);

/**
 * A provider identity is stable across workspace settings, a chat's default,
 * and the immutable record of the provider that handled a turn.
 */
export const gen2ProviderIdSchema = z.enum(["openai", "anthropic", "cursor"]);

export const gen2ProviderCapabilitiesSchema = z.object({
  canRun: z.boolean(),
  canCancel: z.boolean(),
  canStreamActivity: z.boolean(),
  canUseWorkspaceTools: z.boolean(),
});

export const gen2ProviderDescriptorSchema = z.object({
  id: gen2ProviderIdSchema,
  label: z.string().min(1),
  /** Whether a Gen 2 execution adapter is registered for this provider. */
  installed: z.boolean(),
  capabilities: gen2ProviderCapabilitiesSchema,
});

export const gen2ProviderReadinessSchema = gen2ProviderDescriptorSchema.extend({
  /** Redacted member-specific readiness; no credential metadata travels here. */
  ready: z.boolean(),
});

/**
 * The policy decisions resolved for the current member. These flags help the
 * client present available actions; API routes remain the source of authority.
 */
export const gen2WorkspaceCapabilitiesSchema = z.object({
  "workspace.view": z.boolean(),
  "workspace.editFiles": z.boolean(),
  "workspace.useTerminal": z.boolean(),
  "instance.start": z.boolean(),
  "instance.stop": z.boolean(),
  "agent.run": z.boolean(),
  "agent.cancelOwn": z.boolean(),
  "agent.cancelAny": z.boolean(),
  "context.view": z.boolean(),
  "context.includeInTurn": z.boolean(),
  "member.invite": z.boolean(),
  "member.changeRole": z.boolean(),
  "member.remove": z.boolean(),
  "workspace.managePolicy": z.boolean(),
  "connection.manageOwn": z.boolean(),
  "connection.viewStatus": z.boolean(),
});

export const gen2WorkspaceCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    /** Both or neither: a repository is identified by its installation. */
    installationId: z.number().int().positive().optional(),
    repositoryId: z.number().int().positive().optional(),
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
  role: gen2WorkspaceRoleSchema,
});

export const gen2ActiveInviteSchema = z.object({
  active: z.boolean(),
  expiresAt: timestampSchema.nullable(),
});

export const gen2MemberRoleMutationSchema = z.object({
  role: z.enum(["editor", "viewer"]),
});

/** Redacted connection readiness for every provider known to Gen 2. */
export const gen2MemberConnectionStatusSchema = z.object({
  userId: identifierSchema,
  providers: z.array(gen2ProviderReadinessSchema),
});

/**
 * Workspace-wide limits for every agent turn. These are not member roles:
 * role capabilities decide who can start a turn or change this policy.
 */
export const gen2AgentExecutionPolicySchema = z.object({
  /** A false value runs Codex in its read-only sandbox. */
  allowFileChanges: z.boolean(),
});

export const gen2AgentExecutionPolicyUpdateSchema =
  gen2AgentExecutionPolicySchema;

export const gen2WorkspaceSchema = z.object({
  id: identifierSchema,
  name: z.string().min(1).max(80),
  repository: gen2RepositorySchema.nullable().default(null),
  status: gen2WorkspaceStatusSchema,
  sandboxId: z.string().min(1).nullable(),
  lastError: z.string().nullable(),
  role: gen2WorkspaceRoleSchema,
  capabilities: gen2WorkspaceCapabilitiesSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const gen2WorkspaceDetailSchema = gen2WorkspaceSchema.extend({
  members: z.array(gen2WorkspaceMemberSchema),
  /** Present only for callers that can manage workspace invites. */
  activeInvite: gen2ActiveInviteSchema.optional(),
});

export const gen2ShareResponseSchema = z.object({
  inviteUrl: z.url(),
});

export const gen2JoinRequestSchema = z.object({
  token: z.string().min(1),
});

export const gen2AgentStartRequestSchema = z.object({
  chatId: identifierSchema,
  /** Omitted clients use the chat's saved default provider. */
  provider: gen2ProviderIdSchema.optional(),
  prompt: z.string().trim().min(1).max(20_000),
  idempotencyKey: z.string().trim().min(8).max(128),
});

export const gen2AgentStartResponseSchema = z.object({
  sessionId: z.string().min(1).max(80),
  provider: gen2ProviderIdSchema,
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

export const gen2ChatProviderUpdateRequestSchema = z.object({
  defaultProvider: gen2ProviderIdSchema,
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
  /** Null for a member message; identifies the adapter that made a reply. */
  provider: gen2ProviderIdSchema.nullable().default(null),
  body: z.string().min(1),
  /** Activity cards for an assistant message; null for user messages. */
  items: z.array(gen2TurnItemSchema).nullable().default(null),
  createdAt: timestampSchema,
});

export const gen2ChatSchema = z.object({
  id: identifierSchema,
  title: z.string().min(1).max(80),
  defaultProvider: gen2ProviderIdSchema.default("openai"),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const gen2ChatDetailSchema = gen2ChatSchema.extend({
  messages: z.array(gen2ChatMessageSchema),
});

export const gen2ContextPreviewSchema = z.object({
  chatId: identifierSchema,
  messageIds: z.array(identifierSchema),
  messageCount: z.number().int().nonnegative(),
  maxMessages: z.literal(20),
  maxCharacters: z.literal(12_000),
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

export const gen2TerminalActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), ...gen2TerminalDimensions }),
  z.object({
    action: z.literal("input"),
    sessionId: gen2TerminalSessionIdSchema,
    data: z.string().max(64 * 1_024),
  }),
  z.object({
    action: z.literal("resize"),
    sessionId: gen2TerminalSessionIdSchema,
    ...gen2TerminalDimensions,
  }),
  z.object({
    action: z.literal("poll"),
    sessionId: gen2TerminalSessionIdSchema,
    after: z.number().int().nonnegative(),
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

export type Gen2Repository = z.infer<typeof gen2RepositorySchema>;
export type Gen2WorkspaceStatus = z.infer<typeof gen2WorkspaceStatusSchema>;
export type Gen2WorkspaceRole = z.infer<typeof gen2WorkspaceRoleSchema>;
export type Gen2ProviderId = z.infer<typeof gen2ProviderIdSchema>;
export type Gen2ProviderCapabilities = z.infer<
  typeof gen2ProviderCapabilitiesSchema
>;
export type Gen2ProviderDescriptor = z.infer<
  typeof gen2ProviderDescriptorSchema
>;
export type Gen2ProviderReadiness = z.infer<typeof gen2ProviderReadinessSchema>;
export type Gen2WorkspaceCapabilities = z.infer<
  typeof gen2WorkspaceCapabilitiesSchema
>;
export type Gen2Workspace = z.infer<typeof gen2WorkspaceSchema>;
export type Gen2WorkspaceDetail = z.infer<typeof gen2WorkspaceDetailSchema>;
export type Gen2WorkspaceMember = z.infer<typeof gen2WorkspaceMemberSchema>;
export type Gen2ActiveInvite = z.infer<typeof gen2ActiveInviteSchema>;
export type Gen2MemberRoleMutation = z.infer<
  typeof gen2MemberRoleMutationSchema
>;
export type Gen2MemberConnectionStatus = z.infer<
  typeof gen2MemberConnectionStatusSchema
>;
export type Gen2AgentExecutionPolicy = z.infer<
  typeof gen2AgentExecutionPolicySchema
>;
export type Gen2AgentExecutionPolicyUpdate = z.infer<
  typeof gen2AgentExecutionPolicyUpdateSchema
>;
export type Gen2AgentStartRequest = z.infer<typeof gen2AgentStartRequestSchema>;
export type Gen2AgentPollResponse = z.infer<typeof gen2AgentPollResponseSchema>;
export type Gen2Chat = z.infer<typeof gen2ChatSchema>;
export type Gen2ChatProviderUpdateRequest = z.infer<
  typeof gen2ChatProviderUpdateRequestSchema
>;
export type Gen2ChatMessage = z.infer<typeof gen2ChatMessageSchema>;
export type Gen2ChatDetail = z.infer<typeof gen2ChatDetailSchema>;
export type Gen2ContextPreview = z.infer<typeof gen2ContextPreviewSchema>;
export type Gen2TurnItem = z.infer<typeof gen2TurnItemSchema>;
export type Gen2TurnItemStatus = z.infer<typeof gen2TurnItemStatusSchema>;
export type Gen2TurnState = z.infer<typeof gen2TurnStateSchema>;
export type Gen2TurnUsage = z.infer<typeof gen2TurnUsageSchema>;
export type Gen2FileEntry = z.infer<typeof gen2FileEntrySchema>;
export type Gen2FileSearchMatch = z.infer<typeof gen2FileSearchMatchSchema>;
export type Gen2File = z.infer<typeof gen2FileSchema>;
export type Gen2GitOperation = z.infer<typeof gen2GitOperationSchema>;
export type Gen2TerminalAction = z.infer<typeof gen2TerminalActionSchema>;
export type Gen2TerminalPollResponse = z.infer<
  typeof gen2TerminalPollResponseSchema
>;

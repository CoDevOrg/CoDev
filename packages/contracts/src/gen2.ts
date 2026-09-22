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

export const gen2WorkspaceSchema = z.object({
  id: identifierSchema,
  name: z.string().min(1).max(80),
  repository: gen2RepositorySchema.nullable().default(null),
  status: gen2WorkspaceStatusSchema,
  sandboxId: z.string().min(1).nullable(),
  lastError: z.string().nullable(),
  role: gen2WorkspaceRoleSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const gen2WorkspaceDetailSchema = gen2WorkspaceSchema.extend({
  members: z.array(gen2WorkspaceMemberSchema),
});

export const gen2ShareResponseSchema = z.object({
  inviteUrl: z.url(),
});

export const gen2JoinRequestSchema = z.object({
  token: z.string().min(1),
});

export const gen2AgentStartRequestSchema = z.object({
  chatId: identifierSchema,
  prompt: z.string().trim().min(1).max(20_000),
  idempotencyKey: z.string().trim().min(8).max(128),
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
export type Gen2Workspace = z.infer<typeof gen2WorkspaceSchema>;
export type Gen2WorkspaceDetail = z.infer<typeof gen2WorkspaceDetailSchema>;
export type Gen2WorkspaceMember = z.infer<typeof gen2WorkspaceMemberSchema>;
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
export type Gen2GitOperation = z.infer<typeof gen2GitOperationSchema>;
export type Gen2TerminalAction = z.infer<typeof gen2TerminalActionSchema>;
export type Gen2TerminalPollResponse = z.infer<
  typeof gen2TerminalPollResponseSchema
>;

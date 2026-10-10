import { z } from "zod";

import { timestampSchema } from "./domain";
import {
  gen2AgentProviderSchema,
  gen2BranchNameSchema,
  gen2SupersetWorktreeIdSchema,
  gen2WorkspaceRoleSchema,
} from "./gen2-identifiers";

/**
 * What a workspace agent can see of the member's screen and ask the
 * workspace to do. Agents request actions as fenced blocks in their reply
 * (```codev-action <turn token>); the reducer turns each into a
 * `workspaceAction` turn item. Navigation may run without a click; every
 * other action is a proposal the member confirms.
 */

export const GEN2_ACTION_TOKEN_PATTERN = /^[a-z0-9]{10}$/;

const PROTECTED_PATH = /^(?:\.codev-runtime|lost\+found)(?:\/|$)/;

/** A path inside the checkout, as agents and mentions name files. */
export const gen2RelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.includes("\0") &&
      !path.split("/").includes("..") &&
      !PROTECTED_PATH.test(path),
    "Use a path relative to the project root.",
  );

function isSameOriginPath(path: string) {
  try {
    const base = "https://preview.invalid";
    return new URL(path, base).origin === base;
  } catch {
    return false;
  }
}

/** A path on the previewed dev server; never another origin. */
export const gen2PreviewPathSchema = z
  .string()
  .trim()
  .max(512)
  .refine(
    (path) =>
      path.startsWith("/") &&
      !path.startsWith("//") &&
      !path.includes("\\") &&
      !/[\s\p{Cc}]/u.test(path) &&
      isSameOriginPath(path),
    "Use a path that starts with a single /.",
  );

/** One line the member's shell runs; nothing it could hide or reinterpret. */
export const gen2TerminalCommandSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine(
    (command) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(command),
    "Use a single-line command without control characters.",
  );

const worktreeId = gen2SupersetWorktreeIdSchema;
const line = z.number().int().min(1).max(10_000_000);
const port = z.number().int().min(1).max(65_535);

export const gen2WorkspaceActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("open_file"),
    path: gen2RelativePathSchema,
    line: line.optional(),
    endLine: line.optional(),
    worktreeId: worktreeId.optional(),
  }),
  z.object({
    type: z.literal("show_changes"),
    worktreeId: worktreeId.optional(),
  }),
  z.object({
    type: z.literal("open_review"),
    worktreeId: worktreeId.optional(),
    path: gen2RelativePathSchema.optional(),
  }),
  z.object({ type: z.literal("open_terminal") }),
  z.object({
    type: z.literal("open_preview"),
    port,
    path: gen2PreviewPathSchema.optional(),
  }),
  z.object({
    type: z.literal("rename_chat"),
    title: z.string().trim().min(1).max(80),
  }),
  z.object({ type: z.literal("switch_worktree"), worktreeId }),
  z.object({ type: z.literal("open_branch"), branch: gen2BranchNameSchema }),
  z.object({
    type: z.literal("create_branch"),
    branch: gen2BranchNameSchema,
    baseRef: z.string().trim().min(1).max(255).optional(),
  }),
  z.object({
    type: z.literal("open_share"),
    emailOrLogin: z.string().trim().min(1).max(256).optional(),
  }),
  z.object({
    type: z.literal("invite_members"),
    people: z.array(z.string().trim().min(1).max(256)).min(1).max(10),
    role: z.enum(["editor", "viewer"]).default("editor"),
  }),
  z.object({
    type: z.literal("run_in_terminal"),
    command: gen2TerminalCommandSchema,
    worktreeId: worktreeId.optional(),
  }),
  z.object({
    type: z.literal("start_chat"),
    provider: gen2AgentProviderSchema.optional(),
    prompt: z.string().trim().min(1).max(4_000),
  }),
  z.object({ type: z.literal("open_settings") }),
  z.object({
    type: z.literal("update_goal"),
    status: z.literal("achieved"),
    summary: z.string().trim().max(500).optional(),
  }),
]);

/** Actions that only move the member's view, and may run without a click. */
export const GEN2_NAVIGATION_ACTIONS = [
  "open_file",
  "show_changes",
  "open_review",
  "open_terminal",
  "open_preview",
  "rename_chat",
] as const;

const role = gen2WorkspaceRoleSchema;
const text = (max: number) => z.string().max(max);

/** Bounds a client clamps its snapshot to before sending it. */
export const GEN2_WORKSPACE_CONTEXT_LIMITS = {
  worktrees: 20,
  members: 20,
  agents: 10,
  excerpts: 2,
  excerptChars: 2_000,
  listeningPorts: 10,
} as const;

const limits = GEN2_WORKSPACE_CONTEXT_LIMITS;

/** What the member currently sees in the workspace; data, never authority. */
export const gen2WorkspaceContextSchema = z
  .object({
    view: z
      .object({
        mode: z.enum(["ide", "board"]),
        inspector: z.enum(["files", "changes", "review", "browser"]).nullable(),
        terminalOpen: z.boolean(),
        narrow: z.boolean(),
      })
      .strict(),
    worktree: z
      .object({
        id: worktreeId,
        branch: text(255),
        changedFiles: z.number().int().nonnegative().nullable(),
        unsavedEdits: z.boolean(),
      })
      .strict(),
    worktrees: z
      .array(z.object({ id: worktreeId, branch: text(255) }).strict())
      .max(limits.worktrees),
    openFile: z
      .object({
        path: text(1024),
        selection: z
          .object({ startLine: line, endLine: line })
          .strict()
          .nullable(),
      })
      .strict()
      .nullable(),
    preview: z
      .object({ port, path: text(512) })
      .strict()
      .nullable(),
    listeningPorts: z.array(port).max(limits.listeningPorts).nullable(),
    members: z
      .array(z.object({ login: text(80), role }).strict())
      .max(limits.members),
    agents: z
      .array(
        z
          .object({
            provider: text(20),
            status: text(30),
            branch: text(255).nullable(),
            chatTitle: text(80).nullable(),
          })
          .strict(),
      )
      .max(limits.agents),
    excerpts: z
      .array(
        z
          .object({
            kind: z.enum(["selection", "terminal"]),
            ref: text(1024),
            text: text(limits.excerptChars),
          })
          .strict(),
      )
      .max(limits.excerpts),
    previewEnabled: z.boolean(),
  })
  .strict();

/** A chat's goal, derived from its transcript (`/goal …` and agent reports). */
export const gen2ChatGoalSchema = z.object({
  text: z.string().min(1).max(1_000),
  status: z.enum(["active", "achieved"]),
  summary: z.string().max(500).nullable(),
});

export const gen2PreviewSessionRequestSchema = z.object({
  port,
  path: gen2PreviewPathSchema.default("/"),
});

export const gen2PreviewSessionResponseSchema = z.object({
  url: z.string().url(),
  expiresAt: timestampSchema,
});

export const gen2PreviewPortsResponseSchema = z.object({
  /** The zone is configured and this workspace's guest runs the preview proxy. */
  available: z.boolean(),
  reason: z
    .enum(["not_configured", "image_update", "not_ready", "busy"])
    .nullable(),
  ports: z
    .array(z.object({ port, address: z.enum(["loopback", "any"]) }))
    .max(20),
});

export type Gen2WorkspaceAction = z.infer<typeof gen2WorkspaceActionSchema>;
export type Gen2WorkspaceActionType = Gen2WorkspaceAction["type"];
export type Gen2WorkspaceContext = z.infer<typeof gen2WorkspaceContextSchema>;
export type Gen2ChatGoal = z.infer<typeof gen2ChatGoalSchema>;
export type Gen2PreviewSessionRequest = z.infer<
  typeof gen2PreviewSessionRequestSchema
>;
export type Gen2PreviewSessionResponse = z.infer<
  typeof gen2PreviewSessionResponseSchema
>;
export type Gen2PreviewPortsResponse = z.infer<
  typeof gen2PreviewPortsResponseSchema
>;

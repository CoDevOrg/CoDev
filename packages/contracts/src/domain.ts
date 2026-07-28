import { z } from "zod";

export const identifierSchema = z.uuid();
export const timestampSchema = z.iso.datetime();

export const workspaceStatusSchema = z.enum([
  "pending",
  "provisioning",
  "ready",
  "stopping",
  "stopped",
  "failed",
]);

export const userSchema = z.object({
  id: identifierSchema,
  githubUserId: z.string().min(1),
  login: z.string().min(1),
  avatarUrl: z.url().nullable(),
});

export const memberCapabilitiesSchema = z.object({
  canTerminal: z.boolean(),
  canMerge: z.boolean(),
});

export const workspaceMemberSchema = z.object({
  workspaceId: identifierSchema,
  userId: identifierSchema,
  role: z.enum(["owner", "member"]),
  capabilities: memberCapabilitiesSchema,
  joinedAt: timestampSchema,
});

export const workspaceSchema = z.object({
  id: identifierSchema,
  ownerId: identifierSchema,
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  baseSha: z.string().regex(/^[0-9a-f]{40}$/),
  status: workspaceStatusSchema,
  lastActivityAt: timestampSchema,
  expiresAt: timestampSchema,
});

export const sandboxInstanceSchema = z.object({
  id: z.string().min(1),
  workspaceId: identifierSchema,
  status: z.enum(["provisioning", "ready", "stopping", "stopped", "failed"]),
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
  status: agentSessionStatusSchema,
  createdAt: timestampSchema,
});

export const agentTurnSchema = z.object({
  id: identifierSchema,
  sessionId: identifierSchema,
  authorId: identifierSchema,
  prompt: z.string().min(1).max(50_000),
  status: z.enum(["queued", "running", "completed", "interrupted", "failed"]),
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

export const coordinationMessageSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  fromSessionId: identifierSchema,
  toSessionId: identifierSchema,
  kind: z.enum(["claim_request", "claim_response", "handoff", "note"]),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "delivered", "resolved"]),
  createdAt: timestampSchema,
});

export type User = z.infer<typeof userSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type SandboxInstance = z.infer<typeof sandboxInstanceSchema>;
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
export type Worktree = z.infer<typeof worktreeSchema>;
export type AgentSession = z.infer<typeof agentSessionSchema>;
export type AgentTurn = z.infer<typeof agentTurnSchema>;
export type PathClaim = z.infer<typeof pathClaimSchema>;
export type CoordinationMessage = z.infer<typeof coordinationMessageSchema>;

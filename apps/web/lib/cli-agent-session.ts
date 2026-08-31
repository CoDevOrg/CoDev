import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "./database";

/**
 * Coordination for the agent CLIs that actually run the workspace.
 *
 * The workspace's agents are Claude Code / Codex CLIs running inside the
 * embedded IDE, each in its own `codev/<agent>-<hex>` git worktree. They reach
 * the workspace brain and path-claim system through the coordination MCP server
 * (`/api/workspaces/[id]/mcp/coordination`), which needs a stable session
 * identity per agent. That identity is an ordinary `agent_sessions` row stamped
 * `kind: "cli"` so it takes part in coordination without consuming a managed
 * parallel-agent slot, plus its backing `worktrees` row.
 *
 * The MCP bearer token below is an HMAC-signed statement of
 * `{ workspaceId, sessionId, userId }`, minted for the launching member when
 * the IDE registers the agent's worktree. Same signing scheme as
 * `invite-grant.ts`.
 */

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const TOKEN_DOMAIN = "codev-coordination-mcp-v1";

export type CoordinationToken = {
  workspaceId: string;
  sessionId: string;
  userId: string;
  expiresAt: number;
  nonce: string;
};

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required to mint coordination tokens.");
  }
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signatureFor(payload: string): string {
  return createHmac("sha256", getAuthSecret())
    .update(`${TOKEN_DOMAIN}.${payload}`)
    .digest("base64url");
}

export function mintCoordinationToken(input: {
  workspaceId: string;
  sessionId: string;
  userId: string;
}): string {
  const token: CoordinationToken = {
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    userId: input.userId,
    expiresAt: Date.now() + TOKEN_TTL_MS,
    nonce: randomBytes(12).toString("hex"),
  };
  const payload = encode(JSON.stringify(token));
  return `${payload}.${signatureFor(payload)}`;
}

export function openCoordinationToken(
  value: string | undefined | null,
): CoordinationToken | null {
  if (!value) {
    return null;
  }
  const parts = value.trim().split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [payload, providedSignature] = parts;
  if (!payload || !providedSignature) {
    return null;
  }
  const expected = Buffer.from(signatureFor(payload), "base64url");
  const provided = Buffer.from(providedSignature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }
  try {
    const token = JSON.parse(decode(payload)) as Partial<CoordinationToken>;
    if (
      typeof token.workspaceId !== "string" ||
      typeof token.sessionId !== "string" ||
      typeof token.userId !== "string" ||
      typeof token.expiresAt !== "number" ||
      token.expiresAt <= Date.now() ||
      typeof token.nonce !== "string"
    ) {
      return null;
    }
    return token as CoordinationToken;
  } catch {
    return null;
  }
}

/** Bearer prefix the MCP server strips before verifying. */
export const COORDINATION_BEARER_PREFIX = "Bearer ";

const WORKSPACE_TOKEN_DOMAIN = "codev-coordination-workspace-v1";
const WORKSPACE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type WorkspaceCoordinationToken = {
  workspaceId: string;
  expiresAt: number;
  nonce: string;
};

function workspaceSignatureFor(payload: string): string {
  return createHmac("sha256", getAuthSecret())
    .update(`${WORKSPACE_TOKEN_DOMAIN}.${payload}`)
    .digest("base64url");
}

/**
 * A long-lived, workspace-scoped coordination token. Seeded into the
 * workspace's `~/.claude.json` MCP config by the orchestrator, so every agent
 * CLI in the workspace shares it; the agent identifies its own worktree by
 * passing `branch` on each tool call.
 */
export function mintWorkspaceCoordinationToken(workspaceId: string): string {
  const token: WorkspaceCoordinationToken = {
    workspaceId,
    expiresAt: Date.now() + WORKSPACE_TOKEN_TTL_MS,
    nonce: randomBytes(12).toString("hex"),
  };
  const payload = encode(JSON.stringify(token));
  return `${payload}.${workspaceSignatureFor(payload)}`;
}

export function openWorkspaceCoordinationToken(
  value: string | undefined | null,
): WorkspaceCoordinationToken | null {
  if (!value) {
    return null;
  }
  const parts = value.trim().split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [payload, providedSignature] = parts;
  if (!payload || !providedSignature) {
    return null;
  }
  const expected = Buffer.from(workspaceSignatureFor(payload), "base64url");
  const provided = Buffer.from(providedSignature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }
  try {
    const token = JSON.parse(decode(payload)) as Partial<WorkspaceCoordinationToken>;
    if (
      typeof token.workspaceId !== "string" ||
      typeof token.expiresAt !== "number" ||
      token.expiresAt <= Date.now() ||
      typeof token.nonce !== "string"
    ) {
      return null;
    }
    return token as WorkspaceCoordinationToken;
  } catch {
    return null;
  }
}

function providerForAgentKind(agentKind: string): {
  provider: string;
  model: string;
} {
  const normalized = agentKind.trim().toLowerCase();
  if (normalized.includes("codex") || normalized.includes("openai")) {
    return { provider: "openai", model: "codex-cli" };
  }
  if (normalized.includes("claude") || normalized.includes("anthropic")) {
    return { provider: "anthropic", model: "claude-code-cli" };
  }
  return { provider: normalized || "cli", model: `${normalized || "cli"}-cli` };
}

export type RegisterCliAgentSessionInput = {
  workspaceId: string;
  userId: string;
  /** The agent's isolated branch, e.g. `codev/claude-1a2b3c4d`. */
  branch: string;
  /** The worktree directory name the IDE created (unique within the workspace). */
  worktreeName: string;
  /** HEAD sha of the agent's branch at registration time. */
  headSha: string;
  /** `claude`, `codex`, … — from the IDE launch. */
  agentKind: string;
};

/**
 * Idempotently register (or refresh) the `agent_sessions` + `worktrees` rows
 * that stand in for one CLI agent, and return its session id. Keyed on
 * `(workspaceId, worktreeName)` so a relaunch or reconnect of the same agent
 * worktree resolves to the same session rather than piling up rows.
 */
export async function registerCliAgentSession(
  input: RegisterCliAgentSessionInput,
): Promise<{ sessionId: string }> {
  const database = getDatabase();
  const { provider, model } = providerForAgentKind(input.agentKind);
  const displayName = `${input.agentKind.trim() || "agent"} · ${input.branch}`.slice(
    0,
    200,
  );

  return database.transaction(async (transaction) => {
    const [existingWorktree] = await transaction
      .select({ id: schema.worktrees.id })
      .from(schema.worktrees)
      .where(
        and(
          eq(schema.worktrees.workspaceId, input.workspaceId),
          eq(schema.worktrees.name, input.worktreeName),
        ),
      )
      .limit(1);

    const worktreeId =
      existingWorktree?.id ??
      (
        await transaction
          .insert(schema.worktrees)
          .values({
            workspaceId: input.workspaceId,
            kind: "agent",
            name: input.worktreeName,
            headSha: input.headSha,
            status: "active",
          })
          .returning({ id: schema.worktrees.id })
      )[0]!.id;

    if (existingWorktree) {
      await transaction
        .update(schema.worktrees)
        .set({ headSha: input.headSha, status: "active", updatedAt: new Date() })
        .where(eq(schema.worktrees.id, worktreeId));
    }

    const [existingSession] = await transaction
      .select({ id: schema.agentSessions.id })
      .from(schema.agentSessions)
      .where(
        and(
          eq(schema.agentSessions.workspaceId, input.workspaceId),
          eq(schema.agentSessions.worktreeId, worktreeId),
          eq(schema.agentSessions.kind, "cli"),
        ),
      )
      .limit(1);

    if (existingSession) {
      await transaction
        .update(schema.agentSessions)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(schema.agentSessions.id, existingSession.id));
      return { sessionId: existingSession.id };
    }

    const [session] = await transaction
      .insert(schema.agentSessions)
      .values({
        workspaceId: input.workspaceId,
        worktreeId,
        createdBy: input.userId,
        kind: "cli",
        name: displayName,
        provider,
        model,
        status: "running",
      })
      .returning({ id: schema.agentSessions.id });

    return { sessionId: session!.id };
  });
}

/**
 * Resolve — creating if needed — the `cli` agent session for one branch in a
 * workspace, given only the branch name. This is the path the coordination MCP
 * server takes on a workspace-scoped token: the agent passes its own branch on
 * each tool call and the session is upserted here, attributed to the workspace
 * owner (the shared `~/.claude.json` token is not per-member).
 */
export async function resolveCliAgentSessionForBranch(input: {
  workspaceId: string;
  branch: string;
  agentKind?: string;
}): Promise<{ sessionId: string; ownerId: string }> {
  const branch = input.branch.trim();
  if (!branch) {
    throw new Error("A branch is required to resolve a coordination session.");
  }
  const worktreeName = branch.slice(0, 255);
  const database = getDatabase();

  return database.transaction(async (transaction) => {
    const [owner] = await transaction
      .select({ ownerId: schema.workspaces.ownerId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, input.workspaceId))
      .limit(1);
    if (!owner) {
      throw new Error("Workspace not found.");
    }

    const [existingSession] = await transaction
      .select({ id: schema.agentSessions.id })
      .from(schema.agentSessions)
      .innerJoin(
        schema.worktrees,
        eq(schema.agentSessions.worktreeId, schema.worktrees.id),
      )
      .where(
        and(
          eq(schema.agentSessions.workspaceId, input.workspaceId),
          eq(schema.agentSessions.kind, "cli"),
          eq(schema.worktrees.name, worktreeName),
        ),
      )
      .limit(1);
    if (existingSession) {
      return { sessionId: existingSession.id, ownerId: owner.ownerId };
    }

    const [existingWorktree] = await transaction
      .select({ id: schema.worktrees.id })
      .from(schema.worktrees)
      .where(
        and(
          eq(schema.worktrees.workspaceId, input.workspaceId),
          eq(schema.worktrees.name, worktreeName),
        ),
      )
      .limit(1);
    const worktreeId =
      existingWorktree?.id ??
      (
        await transaction
          .insert(schema.worktrees)
          .values({
            workspaceId: input.workspaceId,
            kind: "agent",
            name: worktreeName,
            headSha: "unknown",
            status: "active",
          })
          .returning({ id: schema.worktrees.id })
      )[0]!.id;

    const { provider, model } = providerForAgentKind(input.agentKind ?? "cli");
    const [session] = await transaction
      .insert(schema.agentSessions)
      .values({
        workspaceId: input.workspaceId,
        worktreeId,
        createdBy: owner.ownerId,
        kind: "cli",
        name: `${input.agentKind?.trim() || "agent"} · ${branch}`.slice(0, 200),
        provider,
        model,
        status: "running",
      })
      .returning({ id: schema.agentSessions.id });
    return { sessionId: session!.id, ownerId: owner.ownerId };
  });
}

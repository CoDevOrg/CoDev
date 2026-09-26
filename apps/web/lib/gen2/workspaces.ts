import "server-only";

import { and, eq } from "drizzle-orm";

import {
  gen2WorkspaceDetailSchema,
  gen2WorkspaceSchema,
  type Gen2Workspace,
  type Gen2WorkspaceDetail,
} from "@codev/contracts";
import { schema } from "@codev/db";

import { createInviteToken, hashInviteToken } from "../platform/crypto";
import { getRepository } from "../github/github";
import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import { destroySandbox } from "../runtime/orchestrator-sandbox";
import {
  Gen2AccessError,
  Gen2LifecycleError,
  isGen2HostUnreachable,
} from "./errors";

const DEFAULT_WORKSPACE_NAME = "Workspace";
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export function defaultGen2WorkspaceName(name?: string) {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_WORKSPACE_NAME;
}

function toIso(value: Date) {
  return value.toISOString();
}

function workspaceInviteIsActive(expiresAt: Date | null) {
  return expiresAt !== null && expiresAt.getTime() > Date.now();
}

export async function createGen2Workspace(
  userId: string,
  name?: string,
  repository?: { installationId: number; repositoryId: number },
) {
  // Resolve the repository before anything is written: a repo the member
  // cannot see should fail the create, not leave a half-built workspace.
  const source = repository
    ? await getRepository(
        userId,
        repository.installationId,
        repository.repositoryId,
      )
    : null;
  const workspaceName = defaultGen2WorkspaceName(
    name ?? source?.repository.full_name.split("/").at(-1),
  );
  try {
    const workspace = await getDatabase().transaction(async (transaction) => {
      const [created] = await transaction
        .insert(schema.gen2Workspaces)
        .values({
          ownerId: userId,
          name: workspaceName,
          ...(source
            ? {
                githubInstallationId: repository!.installationId,
                githubRepositoryId: repository!.repositoryId,
                repository: source.repository.full_name,
                repositoryPrivate: source.repository.private,
                defaultBranch: source.repository.default_branch,
                baseSha: source.baseSha,
              }
            : {}),
        })
        .returning();
      if (!created) {
        throw new Error("Workspace creation failed.");
      }
      await transaction.insert(schema.gen2WorkspaceMembers).values({
        workspaceId: created.id,
        userId,
        role: "owner",
      });
      return created;
    });
    return toWorkspace(workspace, "owner");
  } catch (error) {
    if (
      error instanceof Gen2AccessError ||
      error instanceof Gen2LifecycleError
    ) {
      throw error;
    }
    logEvent("error", "gen2.workspace.create_failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    throw new Gen2LifecycleError("Couldn't create this workspace.", 500);
  }
}

export async function listGen2WorkspacesForUser(userId: string) {
  const rows = await getDatabase()
    .select({
      id: schema.gen2Workspaces.id,
      name: schema.gen2Workspaces.name,
      status: schema.gen2Workspaces.status,
      sandboxId: schema.gen2Workspaces.sandboxId,
      lastError: schema.gen2Workspaces.lastError,
      role: schema.gen2WorkspaceMembers.role,
      repository: schema.gen2Workspaces.repository,
      repositoryPrivate: schema.gen2Workspaces.repositoryPrivate,
      defaultBranch: schema.gen2Workspaces.defaultBranch,
      createdAt: schema.gen2Workspaces.createdAt,
      updatedAt: schema.gen2Workspaces.updatedAt,
    })
    .from(schema.gen2WorkspaceMembers)
    .innerJoin(
      schema.gen2Workspaces,
      eq(schema.gen2WorkspaceMembers.workspaceId, schema.gen2Workspaces.id),
    )
    .where(eq(schema.gen2WorkspaceMembers.userId, userId));
  return rows.map((row) => toWorkspace(row, row.role));
}

export async function requireGen2Member(workspaceId: string, userId: string) {
  const [row] = await getDatabase()
    .select({
      id: schema.gen2Workspaces.id,
      name: schema.gen2Workspaces.name,
      status: schema.gen2Workspaces.status,
      sandboxId: schema.gen2Workspaces.sandboxId,
      lastError: schema.gen2Workspaces.lastError,
      role: schema.gen2WorkspaceMembers.role,
      repository: schema.gen2Workspaces.repository,
      repositoryPrivate: schema.gen2Workspaces.repositoryPrivate,
      defaultBranch: schema.gen2Workspaces.defaultBranch,
      createdAt: schema.gen2Workspaces.createdAt,
      updatedAt: schema.gen2Workspaces.updatedAt,
    })
    .from(schema.gen2WorkspaceMembers)
    .innerJoin(
      schema.gen2Workspaces,
      eq(schema.gen2WorkspaceMembers.workspaceId, schema.gen2Workspaces.id),
    )
    .where(
      and(
        eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
        eq(schema.gen2WorkspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Gen2AccessError();
  }
  return toWorkspace(row, row.role);
}

export async function getGen2WorkspaceDetail(
  workspaceId: string,
  userId: string,
): Promise<Gen2WorkspaceDetail> {
  const workspace = await requireGen2Member(workspaceId, userId);
  const members = await getDatabase()
    .select({
      userId: schema.gen2WorkspaceMembers.userId,
      login: schema.users.login,
      name: schema.users.name,
      role: schema.gen2WorkspaceMembers.role,
    })
    .from(schema.gen2WorkspaceMembers)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.gen2WorkspaceMembers.userId),
    )
    .where(eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId));
  return gen2WorkspaceDetailSchema.parse({
    ...workspace,
    members,
  });
}

export async function deleteGen2Workspace(workspaceId: string, userId: string) {
  const workspace = await requireGen2Member(workspaceId, userId);
  if (workspace.role !== "owner") {
    throw new Gen2AccessError("Only the owner can delete this workspace.", 403);
  }

  // The sandbox owns the workspace files and hibernation snapshot. Destroy it
  // before removing the database row when the host is reachable. A host that
  // has already stopped cannot keep a guest alive, so do not strand a failed
  // workspace just because its best-effort teardown cannot connect.
  try {
    await destroySandbox(workspaceId);
  } catch (error) {
    if (!isGen2HostUnreachable(error)) throw error;
    logEvent("warn", "gen2.workspace.delete_host_unreachable", {
      workspaceId,
      detail: error instanceof Error ? error.message : "unknown",
    });
  }
  await getDatabase()
    .delete(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, workspaceId));
}

export async function createGen2ShareLink(
  workspaceId: string,
  userId: string,
  origin: string,
) {
  const membership = await requireGen2Member(workspaceId, userId);
  if (membership.role !== "owner") {
    throw new Gen2AccessError("Only the owner can share this workspace.", 403);
  }
  const token = createInviteToken();
  const createdAt = new Date();
  await getDatabase()
    .update(schema.gen2Workspaces)
    .set({
      activeInviteTokenHash: hashInviteToken(token),
      activeInviteCreatedByUserId: userId,
      activeInviteRole: "editor",
      activeInviteCreatedAt: createdAt,
      activeInviteExpiresAt: new Date(createdAt.getTime() + INVITE_TTL_MS),
      updatedAt: new Date(),
    })
    .where(eq(schema.gen2Workspaces.id, workspaceId));
  return { inviteUrl: `${origin}/gen2/join/${token}` };
}

export async function joinGen2Workspace(token: string, userId: string) {
  const tokenHash = hashInviteToken(token);
  const [workspace] = await getDatabase()
    .select({
      id: schema.gen2Workspaces.id,
      activeInviteExpiresAt: schema.gen2Workspaces.activeInviteExpiresAt,
    })
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.activeInviteTokenHash, tokenHash))
    .limit(1);
  if (!workspace || !workspaceInviteIsActive(workspace.activeInviteExpiresAt)) {
    throw new Gen2AccessError("This invite link is no longer valid.", 404);
  }

  await getDatabase()
    .insert(schema.gen2WorkspaceMembers)
    .values({
      workspaceId: workspace.id,
      userId,
      role: "editor",
    })
    .onConflictDoNothing();

  return requireGen2Member(workspace.id, userId);
}

function toWorkspace(
  row: {
    id: string;
    name: string;
    status: Gen2Workspace["status"];
    sandboxId: string | null;
    lastError: string | null;
    repository?: string | null;
    repositoryPrivate?: boolean | null;
    defaultBranch?: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  role: Gen2Workspace["role"],
): Gen2Workspace {
  return gen2WorkspaceSchema.parse({
    id: row.id,
    name: row.name,
    status: row.status,
    sandboxId: row.sandboxId,
    lastError: row.lastError,
    repository: row.repository
      ? {
          fullName: row.repository,
          private: row.repositoryPrivate ?? false,
          defaultBranch: row.defaultBranch ?? "main",
        }
      : null,
    role,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

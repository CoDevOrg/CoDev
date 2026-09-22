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
import { permissionsForWorkspaceRole } from "../policies/permissions";
import {
  requireWorkspacePermission,
  type WorkspaceAccess,
} from "../policies/workspace";
import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import { Gen2AccessError, Gen2LifecycleError } from "./errors";

const DEFAULT_WORKSPACE_NAME = "Workspace";

export function defaultGen2WorkspaceName(name?: string) {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_WORKSPACE_NAME;
}

function toIso(value: Date) {
  return value.toISOString();
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
  return rows
    .filter((row) => permissionsForWorkspaceRole(row.role)["workspace.view"])
    .map((row) => toWorkspace(row, row.role));
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
  const access = await requireWorkspacePermission(
    workspaceId,
    userId,
    "workspace.view",
  );
  const workspace = await getGen2WorkspaceForAccess(workspaceId, access);
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

export async function createGen2ShareLink(
  workspaceId: string,
  userId: string,
  origin: string,
) {
  await requireWorkspacePermission(workspaceId, userId, "member.invite");
  const token = createInviteToken();
  await getDatabase()
    .update(schema.gen2Workspaces)
    .set({
      shareTokenHash: hashInviteToken(token),
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
    })
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.shareTokenHash, tokenHash))
    .limit(1);
  if (!workspace) {
    throw new Gen2AccessError("This invite link is no longer valid.", 404);
  }

  await getDatabase()
    .insert(schema.gen2WorkspaceMembers)
    .values({
      workspaceId: workspace.id,
      userId,
      // Preserve Gen 2's current shared-workspace behavior while its invite UI
      // has no role picker. The policy foundation will make this explicit.
      role: "editor",
    })
    .onConflictDoNothing();

  const access = await requireWorkspacePermission(
    workspace.id,
    userId,
    "workspace.view",
  );
  return getGen2WorkspaceForAccess(workspace.id, access);
}

/**
 * Loads workspace state only after a policy guard has resolved the caller's
 * authority. It deliberately accepts access rather than a user id, so this
 * data loader cannot become a second membership authorization path.
 */
export async function getGen2WorkspaceForAccess(
  workspaceId: string,
  access: WorkspaceAccess,
) {
  const [row] = await getDatabase()
    .select({
      id: schema.gen2Workspaces.id,
      name: schema.gen2Workspaces.name,
      status: schema.gen2Workspaces.status,
      sandboxId: schema.gen2Workspaces.sandboxId,
      lastError: schema.gen2Workspaces.lastError,
      repository: schema.gen2Workspaces.repository,
      repositoryPrivate: schema.gen2Workspaces.repositoryPrivate,
      defaultBranch: schema.gen2Workspaces.defaultBranch,
      createdAt: schema.gen2Workspaces.createdAt,
      updatedAt: schema.gen2Workspaces.updatedAt,
    })
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, workspaceId))
    .limit(1);
  if (!row) {
    throw new Gen2AccessError();
  }
  return toWorkspace(row, access.role);
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

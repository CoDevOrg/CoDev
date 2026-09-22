import "server-only";

import { and, eq } from "drizzle-orm";

import {
  gen2ContextPreviewSchema,
  gen2WorkspaceDetailSchema,
  gen2WorkspaceSchema,
  type Gen2MemberConnectionStatus,
  type Gen2WorkspaceRole,
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
import { getGen2ProviderStatus } from "./providers";
import { buildGen2Context } from "./chats-format";
import { listGen2ChatMessages, requireGen2Chat } from "./chats";

const DEFAULT_WORKSPACE_NAME = "Workspace";
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

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
  const [invite] = access.capabilities["member.invite"]
    ? await getDatabase()
        .select({
          expiresAt: schema.gen2Workspaces.activeInviteExpiresAt,
        })
        .from(schema.gen2Workspaces)
        .where(eq(schema.gen2Workspaces.id, workspaceId))
        .limit(1)
    : [undefined];
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
    ...(access.capabilities["member.invite"]
      ? {
          activeInvite: {
            active: invite ? workspaceInviteIsActive(invite.expiresAt) : false,
            expiresAt: invite?.expiresAt ? toIso(invite.expiresAt) : null,
          },
        }
      : {}),
  });
}

export async function createGen2ShareLink(
  workspaceId: string,
  userId: string,
  origin: string,
) {
  await requireWorkspacePermission(workspaceId, userId, "member.invite");
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

export async function revokeGen2ShareLink(workspaceId: string, userId: string) {
  await requireWorkspacePermission(workspaceId, userId, "member.invite");
  await getDatabase()
    .update(schema.gen2Workspaces)
    .set({
      activeInviteTokenHash: null,
      activeInviteCreatedByUserId: null,
      activeInviteRole: null,
      activeInviteCreatedAt: null,
      activeInviteExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.gen2Workspaces.id, workspaceId));
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
      // Active invites always grant the fixed editor role.
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

export async function changeGen2MemberRole(input: {
  workspaceId: string;
  userId: string;
  targetUserId: string;
  role: Extract<Gen2WorkspaceRole, "editor" | "viewer">;
}) {
  await requireWorkspacePermission(
    input.workspaceId,
    input.userId,
    "member.changeRole",
  );
  const target = await requireGen2MemberTarget(
    input.workspaceId,
    input.targetUserId,
  );
  if (target.role === "owner") {
    throw new Gen2LifecycleError("Owners cannot be demoted.", 409);
  }
  const [member] = await getDatabase()
    .update(schema.gen2WorkspaceMembers)
    .set({ role: input.role })
    .where(
      and(
        eq(schema.gen2WorkspaceMembers.workspaceId, input.workspaceId),
        eq(schema.gen2WorkspaceMembers.userId, input.targetUserId),
      ),
    )
    .returning({
      userId: schema.gen2WorkspaceMembers.userId,
      role: schema.gen2WorkspaceMembers.role,
    });
  if (!member) throw new Gen2AccessError("Member not found.", 404);
  return member;
}

export async function removeGen2Member(input: {
  workspaceId: string;
  userId: string;
  targetUserId: string;
}) {
  await requireWorkspacePermission(
    input.workspaceId,
    input.userId,
    "member.remove",
  );
  const target = await requireGen2MemberTarget(
    input.workspaceId,
    input.targetUserId,
  );
  if (target.role === "owner") {
    throw new Gen2LifecycleError("Owners cannot be removed.", 409);
  }
  await getDatabase()
    .delete(schema.gen2WorkspaceMembers)
    .where(
      and(
        eq(schema.gen2WorkspaceMembers.workspaceId, input.workspaceId),
        eq(schema.gen2WorkspaceMembers.userId, input.targetUserId),
      ),
    );
}

export async function getGen2MemberConnectionStatuses(
  workspaceId: string,
  userId: string,
): Promise<Gen2MemberConnectionStatus[]> {
  await requireWorkspacePermission(
    workspaceId,
    userId,
    "connection.viewStatus",
  );
  const members = await getDatabase()
    .select({ userId: schema.gen2WorkspaceMembers.userId })
    .from(schema.gen2WorkspaceMembers)
    .where(eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId));
  return Promise.all(
    members.map(async (member) => ({
      userId: member.userId,
      connected: (await getGen2ProviderStatus(member.userId)).connected,
    })),
  );
}

export async function getGen2ContextPreview(input: {
  workspaceId: string;
  chatId: string;
  userId: string;
}) {
  await requireWorkspacePermission(
    input.workspaceId,
    input.userId,
    "context.view",
  );
  const chat = await requireGen2Chat(input.workspaceId, input.chatId);
  const context = buildGen2Context("", await listGen2ChatMessages(chat.id));
  return gen2ContextPreviewSchema.parse({
    chatId: chat.id,
    messageIds: context.messageIds,
    messageCount: context.messageCount,
    maxMessages: context.maxMessages,
    maxCharacters: context.maxCharacters,
  });
}

async function requireGen2MemberTarget(workspaceId: string, userId: string) {
  const [member] = await getDatabase()
    .select({ role: schema.gen2WorkspaceMembers.role })
    .from(schema.gen2WorkspaceMembers)
    .where(
      and(
        eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
        eq(schema.gen2WorkspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!member) throw new Gen2AccessError("Member not found.", 404);
  return member;
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
  return toWorkspace(row, access.role, access.capabilities);
}

function workspaceInviteIsActive(expiresAt: Date | null) {
  return expiresAt !== null && expiresAt > new Date();
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
  capabilities = permissionsForWorkspaceRole(role),
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
    capabilities,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

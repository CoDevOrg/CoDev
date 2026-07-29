import "server-only";

import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { schema } from "@codev/db";

import { createInviteToken, hashInviteToken } from "./crypto";
import { getDatabase } from "./database";
import { getPublicRepository } from "./github";

export async function listWorkspacesForUser(userId: string) {
  return getDatabase()
    .select({
      id: schema.workspaces.id,
      repository: schema.workspaces.repository,
      defaultBranch: schema.workspaces.defaultBranch,
      baseSha: schema.workspaces.baseSha,
      status: schema.workspaces.status,
      role: schema.workspaceMembers.role,
      canTerminal: schema.workspaceMembers.canTerminal,
      canMerge: schema.workspaceMembers.canMerge,
      updatedAt: schema.workspaces.updatedAt,
    })
    .from(schema.workspaceMembers)
    .innerJoin(
      schema.workspaces,
      eq(schema.workspaceMembers.workspaceId, schema.workspaces.id),
    )
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(desc(schema.workspaces.updatedAt));
}

export async function createWorkspace(
  userId: string,
  installationId: number,
  repositoryId: number,
) {
  const { repository, baseSha } = await getPublicRepository(
    userId,
    installationId,
    repositoryId,
  );
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);

  return getDatabase().transaction(async (transaction) => {
    const [workspace] = await transaction
      .insert(schema.workspaces)
      .values({
        ownerId: userId,
        githubInstallationId: BigInt(installationId),
        githubRepositoryId: BigInt(repository.id),
        repository: repository.full_name,
        defaultBranch: repository.default_branch,
        baseSha,
        expiresAt,
      })
      .returning();

    if (!workspace) {
      throw new Error("Workspace creation failed.");
    }

    await transaction.insert(schema.workspaceMembers).values({
      workspaceId: workspace.id,
      userId,
      role: "owner",
      canTerminal: true,
      canMerge: true,
    });

    await transaction.insert(schema.worktrees).values({
      workspaceId: workspace.id,
      kind: "integration",
      name: "integration",
      headSha: baseSha,
    });

    return workspace;
  });
}

export async function getWorkspaceForMember(
  workspaceId: string,
  userId: string,
) {
  const [workspace] = await getDatabase()
    .select({
      id: schema.workspaces.id,
      repository: schema.workspaces.repository,
      defaultBranch: schema.workspaces.defaultBranch,
      baseSha: schema.workspaces.baseSha,
      status: schema.workspaces.status,
      ownerId: schema.workspaces.ownerId,
      expiresAt: schema.workspaces.expiresAt,
      role: schema.workspaceMembers.role,
      canTerminal: schema.workspaceMembers.canTerminal,
      canMerge: schema.workspaceMembers.canMerge,
    })
    .from(schema.workspaceMembers)
    .innerJoin(
      schema.workspaces,
      eq(schema.workspaceMembers.workspaceId, schema.workspaces.id),
    )
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    )
    .limit(1);

  return workspace;
}

export async function getWorkspaceRuntime(workspaceId: string) {
  const [runtime] = await getDatabase()
    .select()
    .from(schema.workspaceRuntimes)
    .where(eq(schema.workspaceRuntimes.workspaceId, workspaceId))
    .limit(1);
  return runtime;
}

export async function beginWorkspaceProvisioning(
  workspaceId: string,
  userId: string,
) {
  await requireOwner(workspaceId, userId);
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
  await getDatabase().transaction(async (transaction) => {
    await transaction
      .insert(schema.workspaceRuntimes)
      .values({
        workspaceId,
        status: "provisioning",
        lastError: null,
        stoppedAt: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.workspaceRuntimes.workspaceId,
        set: {
          sandboxId: null,
          status: "provisioning",
          lastError: null,
          stoppedAt: null,
          updatedAt: new Date(),
        },
      });
    await transaction
      .update(schema.workspaces)
      .set({ status: "provisioning", expiresAt, updatedAt: new Date() })
      .where(eq(schema.workspaces.id, workspaceId));
  });
  return expiresAt;
}

export async function markWorkspaceReady(
  workspaceId: string,
  sandboxId: string,
) {
  const now = new Date();
  await getDatabase().transaction(async (transaction) => {
    await transaction
      .update(schema.workspaceRuntimes)
      .set({
        sandboxId,
        status: "ready",
        provisionedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(schema.workspaceRuntimes.workspaceId, workspaceId));
    await transaction
      .update(schema.workspaces)
      .set({ status: "ready", lastActivityAt: now, updatedAt: now })
      .where(eq(schema.workspaces.id, workspaceId));
  });
}

export async function markWorkspaceFailed(workspaceId: string, error: unknown) {
  const message =
    error instanceof Error
      ? error.message.slice(0, 2_000)
      : "Provisioning failed.";
  const now = new Date();
  await getDatabase().transaction(async (transaction) => {
    await transaction
      .update(schema.workspaceRuntimes)
      .set({ status: "failed", lastError: message, updatedAt: now })
      .where(eq(schema.workspaceRuntimes.workspaceId, workspaceId));
    await transaction
      .update(schema.workspaces)
      .set({ status: "failed", updatedAt: now })
      .where(eq(schema.workspaces.id, workspaceId));
  });
}

export async function beginWorkspaceStop(workspaceId: string, userId: string) {
  await requireOwner(workspaceId, userId);
  const now = new Date();
  await getDatabase().transaction(async (transaction) => {
    await transaction
      .update(schema.workspaceRuntimes)
      .set({ status: "stopping", updatedAt: now })
      .where(eq(schema.workspaceRuntimes.workspaceId, workspaceId));
    await transaction
      .update(schema.workspaces)
      .set({ status: "stopping", updatedAt: now })
      .where(eq(schema.workspaces.id, workspaceId));
  });
}

export async function markWorkspaceStopped(workspaceId: string) {
  const now = new Date();
  await getDatabase().transaction(async (transaction) => {
    await transaction
      .update(schema.workspaceRuntimes)
      .set({
        sandboxId: null,
        status: "stopped",
        stoppedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.workspaceRuntimes.workspaceId, workspaceId));
    await transaction
      .update(schema.workspaces)
      .set({ status: "stopped", updatedAt: now })
      .where(eq(schema.workspaces.id, workspaceId));
  });
}

export async function listWorkspaceMembers(workspaceId: string) {
  return getDatabase()
    .select({
      userId: schema.users.id,
      login: schema.users.login,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      role: schema.workspaceMembers.role,
      canTerminal: schema.workspaceMembers.canTerminal,
      canMerge: schema.workspaceMembers.canMerge,
      joinedAt: schema.workspaceMembers.joinedAt,
    })
    .from(schema.workspaceMembers)
    .innerJoin(
      schema.users,
      eq(schema.workspaceMembers.userId, schema.users.id),
    )
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId))
    .orderBy(schema.workspaceMembers.joinedAt);
}

async function requireOwner(workspaceId: string, userId: string) {
  const [membership] = await getDatabase()
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    )
    .limit(1);

  if (membership?.role !== "owner") {
    throw new Error("Only the workspace owner can perform this action.");
  }
}

export async function createWorkspaceInvite(
  workspaceId: string,
  userId: string,
) {
  await requireOwner(workspaceId, userId);
  const token = createInviteToken();
  const [invite] = await getDatabase()
    .insert(schema.workspaceInvites)
    .values({
      workspaceId,
      createdBy: userId,
      tokenHash: hashInviteToken(token),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning({ id: schema.workspaceInvites.id });

  return { id: invite?.id, token };
}

export async function revokeWorkspaceInvite(
  workspaceId: string,
  inviteId: string,
  userId: string,
) {
  await requireOwner(workspaceId, userId);
  await getDatabase()
    .update(schema.workspaceInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.workspaceInvites.id, inviteId),
        eq(schema.workspaceInvites.workspaceId, workspaceId),
        isNull(schema.workspaceInvites.revokedAt),
      ),
    );
}

export async function acceptWorkspaceInvite(token: string, userId: string) {
  const tokenHash = hashInviteToken(token);

  return getDatabase().transaction(async (transaction) => {
    const [invite] = await transaction
      .select()
      .from(schema.workspaceInvites)
      .where(
        and(
          eq(schema.workspaceInvites.tokenHash, tokenHash),
          isNull(schema.workspaceInvites.revokedAt),
          isNull(schema.workspaceInvites.acceptedAt),
          gt(schema.workspaceInvites.expiresAt, new Date()),
        ),
      )
      .limit(1)
      .for("update");

    if (!invite) {
      throw new Error("This invite is invalid, expired, or already used.");
    }

    await transaction
      .insert(schema.workspaceMembers)
      .values({ workspaceId: invite.workspaceId, userId })
      .onConflictDoNothing();

    await transaction
      .update(schema.workspaceInvites)
      .set({ acceptedAt: new Date(), acceptedBy: userId })
      .where(eq(schema.workspaceInvites.id, invite.id));

    return invite.workspaceId;
  });
}

export async function updateMemberCapabilities(
  workspaceId: string,
  memberUserId: string,
  ownerUserId: string,
  capabilities: { canTerminal: boolean; canMerge: boolean },
) {
  await requireOwner(workspaceId, ownerUserId);
  if (memberUserId === ownerUserId) {
    throw new Error("Owner capabilities cannot be removed.");
  }

  const [membership] = await getDatabase()
    .update(schema.workspaceMembers)
    .set(capabilities)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, memberUserId),
        eq(schema.workspaceMembers.role, "member"),
      ),
    )
    .returning({ userId: schema.workspaceMembers.userId });

  if (!membership) {
    throw new Error("Workspace member was not found.");
  }
}

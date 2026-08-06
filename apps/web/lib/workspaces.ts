import "server-only";

import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { schema } from "@codev/db";

import { appendWorkspaceEvent } from "./audit";
import {
  getWorkspaceAccess,
  requireWorkspacePermission,
  WorkspaceAccessError,
  type WorkspaceAccessRole,
  writeWorkspaceTuple,
} from "./access";
import { createInviteToken, hashInviteToken } from "./crypto";
import { getDatabase } from "./database";
import { getRepository } from "./github";
import { requireOrganizationSettingsWrite } from "./settings-access";
import { assertWorkspaceQuota } from "./quotas";
import { closeSandboxInterval, openSandboxInterval } from "./vm-usage";
import {
  hasUnpublishedRuntimeChanges,
  workspaceSyncBlockReason,
} from "./workspace-lifecycle";

export const workspaceRuntimeTtlMs = 4 * 60 * 60 * 1000;

export function inviteAllowsUser(
  invite: {
    allowLink: boolean;
    inviteeEmail: string | null;
    inviteeLogin: string | null;
  },
  user: { email: string | null; login: string },
) {
  if (invite.allowLink) return true;
  return Boolean(
    (invite.inviteeEmail &&
      invite.inviteeEmail.toLowerCase() === user.email?.toLowerCase()) ||
    (invite.inviteeLogin &&
      invite.inviteeLogin.toLowerCase() === user.login.toLowerCase()),
  );
}

export class WorkspaceLifecycleError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "WorkspaceLifecycleError";
  }
}

export async function listWorkspacesForUser(userId: string) {
  const workspaces = await getDatabase()
    .select({
      id: schema.workspaces.id,
      repository: schema.workspaces.repository,
      repositoryVisibility: schema.workspaces.repositoryVisibility,
      defaultBranch: schema.workspaces.defaultBranch,
      baseSha: schema.workspaces.baseSha,
      status: schema.workspaces.status,
      role: schema.workspaceMembers.role,
      accessRole: schema.workspaceMembers.accessRole,
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

  const visible = await Promise.all(
    workspaces.map(async (workspace) => {
      try {
        return (await getWorkspaceAccess(workspace.id, userId))
          ? workspace
          : null;
      } catch (error) {
        if (error instanceof WorkspaceAccessError && error.status === 403) {
          return null;
        }
        throw error;
      }
    }),
  );
  return visible.filter((workspace) => workspace !== null);
}

export async function createWorkspace(
  userId: string,
  installationId?: number,
  repositoryId?: number,
) {
  await assertWorkspaceQuota(userId);
  if ((installationId === undefined) !== (repositoryId === undefined)) {
    throw new Error(
      "Choose a repository installation and repository together, or create an empty workspace.",
    );
  }

  const repositoryData =
    installationId === undefined || repositoryId === undefined
      ? null
      : await getRepository(userId, installationId, repositoryId);
  const repository = repositoryData?.repository ?? null;
  const baseSha = repositoryData?.baseSha ?? "";
  const expiresAt = new Date(Date.now() + workspaceRuntimeTtlMs);

  const workspace = await getDatabase().transaction(async (transaction) => {
    const [workspace] = await transaction
      .insert(schema.workspaces)
      .values({
        ownerId: userId,
        githubInstallationId:
          installationId === undefined ? null : BigInt(installationId),
        githubRepositoryId:
          repositoryId === undefined ? null : BigInt(repositoryId),
        repository: repository?.full_name ?? "",
        repositoryVisibility: repository
          ? repository.private
            ? "private"
            : "public"
          : "none",
        defaultBranch: repository?.default_branch ?? "",
        baseSha,
        hibernateAt: expiresAt,
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
      accessRole: "owner",
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

  await writeWorkspaceTuple({
    workspaceId: workspace.id,
    userId,
    role: "owner",
  });
  return workspace;
}

export async function getWorkspaceForMember(
  workspaceId: string,
  userId: string,
) {
  const [workspace] = await getDatabase()
    .select({
      id: schema.workspaces.id,
      repository: schema.workspaces.repository,
      repositoryVisibility: schema.workspaces.repositoryVisibility,
      githubInstallationId: schema.workspaces.githubInstallationId,
      githubRepositoryId: schema.workspaces.githubRepositoryId,
      defaultBranch: schema.workspaces.defaultBranch,
      baseSha: schema.workspaces.baseSha,
      status: schema.workspaces.status,
      ownerId: schema.workspaces.ownerId,
      expiresAt: schema.workspaces.expiresAt,
      role: schema.workspaceMembers.role,
      accessRole: schema.workspaceMembers.accessRole,
      canTerminal: schema.workspaceMembers.canTerminal,
      canMerge: schema.workspaceMembers.canMerge,
      integrationHeadSha: schema.worktrees.headSha,
    })
    .from(schema.workspaceMembers)
    .innerJoin(
      schema.workspaces,
      eq(schema.workspaceMembers.workspaceId, schema.workspaces.id),
    )
    .innerJoin(
      schema.worktrees,
      and(
        eq(schema.worktrees.workspaceId, schema.workspaces.id),
        eq(schema.worktrees.kind, "integration"),
      ),
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

export async function syncWorkspaceToDefaultBranch(
  workspaceId: string,
  userId: string,
) {
  await requireOwner(workspaceId, userId);
  const workspace = await getWorkspaceForMember(workspaceId, userId);
  if (!workspace) {
    throw new WorkspaceLifecycleError("Workspace not found.", 404);
  }
  if (
    !workspace.repository ||
    !workspace.baseSha ||
    workspace.githubInstallationId === null ||
    workspace.githubRepositoryId === null
  ) {
    throw new WorkspaceLifecycleError(
      "Connect a GitHub repository before syncing this workspace.",
    );
  }
  const blocked = workspaceSyncBlockReason(workspace.role, workspace.status);
  if (blocked === "not_owner") {
    throw new WorkspaceLifecycleError(
      "Only the workspace owner can sync the repository.",
      403,
    );
  }
  if (blocked === "not_stopped") {
    throw new WorkspaceLifecycleError(
      "Stop the sandbox before syncing to the latest default branch.",
    );
  }

  const { repository, baseSha } = await getRepository(
    userId,
    Number(workspace.githubInstallationId),
    Number(workspace.githubRepositoryId),
  );
  if (baseSha === workspace.baseSha) {
    return {
      updated: false as const,
      baseSha,
      defaultBranch: repository.default_branch,
    };
  }

  const now = new Date();
  await getDatabase().transaction(async (transaction) => {
    await transaction
      .update(schema.workspaces)
      .set({
        baseSha,
        defaultBranch: repository.default_branch,
        updatedAt: now,
      })
      .where(eq(schema.workspaces.id, workspaceId));
    await transaction
      .update(schema.worktrees)
      .set({ headSha: baseSha, updatedAt: now })
      .where(
        and(
          eq(schema.worktrees.workspaceId, workspaceId),
          eq(schema.worktrees.kind, "integration"),
        ),
      );
  });
  await appendWorkspaceEvent({
    workspaceId,
    actorId: userId,
    type: "workspace.synced",
    payload: { previousBaseSha: workspace.baseSha, baseSha },
  }).catch(() => undefined);

  return {
    updated: true as const,
    baseSha,
    previousBaseSha: workspace.baseSha,
    defaultBranch: repository.default_branch,
  };
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
  permission: "coSteer" | "review" = "coSteer",
) {
  await requireWorkspacePermission(workspaceId, userId, permission);
  const expiresAt = new Date(Date.now() + workspaceRuntimeTtlMs);
  await getDatabase().transaction(async (transaction) => {
    const [current] = await transaction
      .select({
        workspaceStatus: schema.workspaces.status,
        runtimeStatus: schema.workspaceRuntimes.status,
      })
      .from(schema.workspaces)
      .leftJoin(
        schema.workspaceRuntimes,
        eq(schema.workspaceRuntimes.workspaceId, schema.workspaces.id),
      )
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1)
      .for("update", { of: schema.workspaces });
    if (
      current?.workspaceStatus === "stopping" ||
      current?.runtimeStatus === "stopping"
    ) {
      throw new WorkspaceLifecycleError(
        "The workspace is being hibernated. Try again after it finishes.",
        409,
      );
    }
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
  headSha: string,
) {
  const now = new Date();
  const hibernateAt = new Date(now.getTime() + workspaceRuntimeTtlMs);
  const [workspace] = await getDatabase()
    .select({ ownerId: schema.workspaces.ownerId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  await getDatabase().transaction(async (transaction) => {
    await transaction
      .update(schema.workspaceRuntimes)
      .set({
        sandboxId,
        status: "ready",
        provisionedHeadSha: headSha,
        provisionedAt: now,
        lastHeartbeatAt: now,
        hibernatedAt: null,
        snapshotRef: null,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(schema.workspaceRuntimes.workspaceId, workspaceId));
    await transaction
      .update(schema.workspaces)
      .set({
        status: "ready",
        lastActivityAt: now,
        hibernateAt,
        updatedAt: now,
      })
      .where(eq(schema.workspaces.id, workspaceId));
    await transaction
      .update(schema.worktrees)
      .set({ headSha, updatedAt: now })
      .where(
        and(
          eq(schema.worktrees.workspaceId, workspaceId),
          eq(schema.worktrees.kind, "integration"),
        ),
      );
  });
  if (workspace?.ownerId) {
    await openSandboxInterval(workspace.ownerId, workspaceId, "provision");
  }
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

export async function markWorkspaceStopped(workspaceId: string) {
  await closeSandboxInterval(workspaceId, "stop");
  const now = new Date();
  await getDatabase().transaction(async (transaction) => {
    const [state] = await transaction
      .select({
        baseSha: schema.workspaces.baseSha,
        integrationHeadSha: schema.worktrees.headSha,
        integrationId: schema.worktrees.id,
        provisionedHeadSha: schema.workspaceRuntimes.provisionedHeadSha,
      })
      .from(schema.workspaces)
      .innerJoin(
        schema.workspaceRuntimes,
        eq(schema.workspaceRuntimes.workspaceId, schema.workspaces.id),
      )
      .innerJoin(
        schema.worktrees,
        and(
          eq(schema.worktrees.workspaceId, schema.workspaces.id),
          eq(schema.worktrees.kind, "integration"),
        ),
      )
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1)
      .for("update");
    const hasUnpublishedChanges =
      state &&
      hasUnpublishedRuntimeChanges(
        state.integrationHeadSha,
        state.provisionedHeadSha,
        state.baseSha,
      );
    const [publication] = hasUnpublishedChanges
      ? await transaction
          .select({ commitSha: schema.publishedBranches.commitSha })
          .from(schema.publishedBranches)
          .where(
            and(
              eq(schema.publishedBranches.workspaceId, workspaceId),
              eq(schema.publishedBranches.status, "published"),
              eq(
                schema.publishedBranches.sourceHeadSha,
                state.integrationHeadSha,
              ),
            ),
          )
          .orderBy(desc(schema.publishedBranches.publishedAt))
          .limit(1)
      : [];
    if (state && hasUnpublishedChanges && !publication?.commitSha) {
      const message =
        "The sandbox disappeared before its integration revision was published.";
      await transaction
        .update(schema.workspaceRuntimes)
        .set({
          sandboxId: null,
          status: "failed",
          lastError: message,
          stoppedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.workspaceRuntimes.workspaceId, workspaceId));
      await transaction
        .update(schema.workspaces)
        .set({ status: "failed", updatedAt: now })
        .where(eq(schema.workspaces.id, workspaceId));
      return;
    }
    if (state && publication?.commitSha) {
      await transaction
        .update(schema.worktrees)
        .set({ headSha: publication.commitSha, updatedAt: now })
        .where(eq(schema.worktrees.id, state.integrationId));
      await transaction
        .update(schema.workspaces)
        .set({ baseSha: publication.commitSha, updatedAt: now })
        .where(eq(schema.workspaces.id, workspaceId));
    }
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
      accessRole: schema.workspaceMembers.accessRole,
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
  await requireWorkspacePermission(workspaceId, userId, "invite");
}

export async function createWorkspaceInvite(
  workspaceId: string,
  userId: string,
  options: {
    accessRole?: Exclude<WorkspaceAccessRole, "owner">;
    inviteeEmail?: string | null;
    inviteeLogin?: string | null;
    allowLink?: boolean;
  } = {},
) {
  const access = await requireWorkspacePermission(workspaceId, userId, "view");
  if (access.role !== "owner" && access.role !== "co_steer") {
    throw new WorkspaceAccessError(
      "Only workspace owners and Co-Steer members can share this workspace.",
    );
  }
  await requireOrganizationSettingsWrite(userId, workspaceId);
  const token = createInviteToken();
  const accessRole =
    access.role === "owner" ? (options.accessRole ?? "co_steer") : "viewer";
  const [invite] = await getDatabase()
    .insert(schema.workspaceInvites)
    .values({
      workspaceId,
      createdBy: userId,
      tokenHash: hashInviteToken(token),
      accessRole,
      inviteeEmail: options.inviteeEmail ?? null,
      inviteeLogin: options.inviteeLogin ?? null,
      allowLink:
        options.allowLink ?? (!options.inviteeEmail && !options.inviteeLogin),
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
  await requireOrganizationSettingsWrite(userId, workspaceId);
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

  const accepted = await getDatabase().transaction(async (transaction) => {
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

    const [user] = await transaction
      .select({ email: schema.users.email, login: schema.users.login })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) throw new Error("User not found.");
    if (!inviteAllowsUser(invite, user)) {
      throw new Error("This invitation was issued to a different person.");
    }

    await transaction
      .insert(schema.workspaceMembers)
      .values({
        workspaceId: invite.workspaceId,
        userId,
        accessRole: invite.accessRole,
        canTerminal: invite.accessRole !== "viewer",
        canMerge: invite.accessRole === "co_steer",
      })
      .onConflictDoNothing();

    await transaction
      .update(schema.workspaceInvites)
      .set({ acceptedAt: new Date(), acceptedBy: userId })
      .where(eq(schema.workspaceInvites.id, invite.id));

    return {
      workspaceId: invite.workspaceId,
      accessRole: invite.accessRole,
    };
  });

  await writeWorkspaceTuple({
    workspaceId: accepted.workspaceId,
    userId,
    role: accepted.accessRole,
  });
  return accepted.workspaceId;
}

export async function updateMemberAccessRole(
  workspaceId: string,
  memberUserId: string,
  ownerUserId: string,
  accessRole: Exclude<WorkspaceAccessRole, "owner">,
) {
  await requireOwner(workspaceId, ownerUserId);
  if (memberUserId === ownerUserId) {
    throw new Error("Owner capabilities cannot be removed.");
  }

  const [membership] = await getDatabase()
    .select({ accessRole: schema.workspaceMembers.accessRole })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, memberUserId),
        eq(schema.workspaceMembers.role, "member"),
      ),
    )
    .limit(1);
  if (!membership) throw new Error("Workspace member was not found.");

  await getDatabase()
    .update(schema.workspaceMembers)
    .set({
      accessRole,
      canTerminal: accessRole !== "viewer",
      canMerge: accessRole === "co_steer",
    })
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, memberUserId),
      ),
    );
  await writeWorkspaceTuple({
    workspaceId,
    userId: memberUserId,
    role: accessRole,
    deleteRole: membership.accessRole,
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

export async function deleteWorkspace(workspaceId: string, userId: string) {
  const access = await getWorkspaceAccess(workspaceId, userId);
  if (!access) {
    throw new WorkspaceAccessError(
      "Workspace not found or access denied.",
      404,
    );
  }
  if (access.role !== "owner" && !access.permissions.merge) {
    throw new WorkspaceAccessError(
      "You do not have permission to delete this workspace.",
      403,
    );
  }

  const db = getDatabase();

  const sessions = await db
    .select({ id: schema.agentSessions.id })
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.workspaceId, workspaceId));

  for (const session of sessions) {
    await db
      .delete(schema.agentTurns)
      .where(eq(schema.agentTurns.sessionId, session.id));
  }

  await db
    .delete(schema.agentEvents)
    .where(eq(schema.agentEvents.workspaceId, workspaceId));
  await db
    .delete(schema.agentSessions)
    .where(eq(schema.agentSessions.workspaceId, workspaceId));
  await db
    .delete(schema.workspaceInvites)
    .where(eq(schema.workspaceInvites.workspaceId, workspaceId));
  await db
    .delete(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId));
  await db
    .delete(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId));

  await appendWorkspaceEvent({
    workspaceId,
    actorId: userId,
    type: "WORKSPACE_DELETED",
    payload: { deletedAt: new Date().toISOString() },
  }).catch(() => undefined);
}

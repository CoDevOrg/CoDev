import "server-only";

import { and, asc, count, eq, or, sql } from "drizzle-orm";

import {
  gen2WorkspaceDetailSchema,
  gen2WorkspaceSchema,
  type Gen2Workspace,
  type Gen2WorkspaceDetail,
  type Gen2WorkspaceMember,
  type Gen2WorkspaceRole,
} from "@codev/contracts";
import { schema } from "@codev/db";

import { createInviteToken, hashInviteToken } from "../platform/crypto";
import { requireIndividualPlan } from "../billing/access";
import { getRepository } from "../github/github";
import { getDatabase } from "../platform/database";
import { logEvent } from "../platform/observability";
import { ensureHostReady } from "../runtime/orchestrator-health";
import {
  destroySandbox,
  discardSandboxSnapshot,
} from "../runtime/orchestrator-sandbox";
import { GEN2_MAX_OWNED_WORKSPACES } from "./constants";
import {
  assertComputeAvailable,
  endComputeSession,
  transferActiveComputeSession,
} from "./compute-quota";
import { Gen2AccessError, Gen2LifecycleError } from "./errors";

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
  // Hard paywall: a workspace costs a machine, so creating one needs the plan.
  await requireIndividualPlan(userId);
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
      // Serialize creates for this owner so two simultaneous requests cannot
      // both observe the last available slot.
      await transaction
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .for("update");
      const [owned] = await transaction
        .select({ count: count() })
        .from(schema.gen2Workspaces)
        .where(eq(schema.gen2Workspaces.ownerId, userId));
      if ((owned?.count ?? 0) >= GEN2_MAX_OWNED_WORKSPACES) {
        throw new Gen2LifecycleError(
          `You can own up to ${GEN2_MAX_OWNED_WORKSPACES} Gen 2 workspaces. Delete one to create another.`,
          409,
        );
      }

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

export async function requireGen2Member(
  workspaceId: string,
  userId: string,
  options: { allowDeleting?: boolean } = {},
) {
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
  if (row.status === "deleting" && !options.allowDeleting) {
    throw new Gen2LifecycleError("This workspace is being deleted.");
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
      email: schema.users.email,
      avatarUrl: schema.users.avatarUrl,
      role: schema.gen2WorkspaceMembers.role,
      joinedAt: schema.gen2WorkspaceMembers.joinedAt,
    })
    .from(schema.gen2WorkspaceMembers)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.gen2WorkspaceMembers.userId),
    )
    .where(eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(schema.gen2WorkspaceMembers.joinedAt));
  return gen2WorkspaceDetailSchema.parse({
    ...workspace,
    members: members.map((m) => ({
      ...m,
      joinedAt: m.joinedAt ? m.joinedAt.toISOString() : undefined,
    })),
  });
}

const DELETE_HOST_WAIT_MS = 8_000;
const DELETE_GUEST_TIMEOUT_MS = 8_000;

async function removeWorkspaceRuntime(workspaceId: string) {
  let hostReady = false;
  try {
    await ensureHostReady(DELETE_HOST_WAIT_MS);
    hostReady = true;
  } catch (error) {
    logEvent("error", "gen2.workspace.delete_host_unreachable", {
      detail: error instanceof Error ? error.message : "unknown",
    });
  }

  try {
    await destroySandbox(workspaceId, DELETE_GUEST_TIMEOUT_MS);
    await endComputeSession(workspaceId);
    await discardSandboxSnapshot(workspaceId, DELETE_GUEST_TIMEOUT_MS);
  } catch (error) {
    if (hostReady) throw error;
    logEvent("error", "gen2.workspace.delete_guest_unreachable", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    await endComputeSession(workspaceId);
  }
}

export async function deleteGen2Workspace(workspaceId: string, userId: string) {
  const workspace = await requireGen2Member(workspaceId, userId, {
    allowDeleting: true,
  });
  if (workspace.role !== "owner") {
    throw new Gen2AccessError("Only the owner can delete this workspace.", 403);
  }
  if (workspace.status === "provisioning") {
    throw new Gen2LifecycleError(
      "Wait for the workspace to finish starting before deleting it.",
    );
  }

  const database = getDatabase();
  const currentStatus = await database.transaction(async (transaction) => {
    const [current] = await transaction
      .select({
        ownerId: schema.gen2Workspaces.ownerId,
        status: schema.gen2Workspaces.status,
      })
      .from(schema.gen2Workspaces)
      .where(eq(schema.gen2Workspaces.id, workspaceId))
      .for("update");
    if (!current) throw new Gen2AccessError();
    if (current.ownerId !== userId) {
      throw new Gen2AccessError(
        "Only the owner can delete this workspace.",
        403,
      );
    }
    if (current.status === "provisioning") {
      throw new Gen2LifecycleError(
        "Wait for the workspace to finish starting before deleting it.",
      );
    }
    if (current.status !== "deleting") {
      await transaction
        .update(schema.gen2Workspaces)
        .set({ status: "deleting", lastError: null, updatedAt: new Date() })
        .where(eq(schema.gen2Workspaces.id, workspaceId));
    }
    return current.status;
  });

  try {
    // A never-started workspace has no guest or snapshot, so don't wake a host
    // just to delete its database row. For all other states, make sure the
    // host is responsive before teardown so an unreachable-host timeout does
    // not consume most of Vercel's function budget before the wake attempt.
    if (currentStatus !== "pending") {
      await removeWorkspaceRuntime(workspaceId);
    }
    await database
      .delete(schema.gen2Workspaces)
      .where(
        and(
          eq(schema.gen2Workspaces.id, workspaceId),
          eq(schema.gen2Workspaces.ownerId, userId),
          eq(schema.gen2Workspaces.status, "deleting"),
        ),
      );
  } catch (error) {
    logEvent("error", "gen2.workspace.delete_failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    try {
      await database
        .update(schema.gen2Workspaces)
        .set({
          lastError:
            "Deletion did not finish. Retry deletion from the workspace list.",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.gen2Workspaces.id, workspaceId),
            eq(schema.gen2Workspaces.status, "deleting"),
          ),
        );
    } catch (updateError) {
      logEvent("error", "gen2.workspace.delete_status_failed", {
        detail: updateError instanceof Error ? updateError.message : "unknown",
      });
    }
    throw new Gen2LifecycleError(
      "Couldn't fully delete this workspace. Retry deletion from the workspace list.",
      502,
    );
  }
}

export async function createGen2ShareLink(
  workspaceId: string,
  userId: string,
  origin: string,
  role: Gen2WorkspaceRole = "editor",
) {
  const membership = await requireGen2Member(workspaceId, userId);
  if (membership.role === "viewer") {
    throw new Gen2AccessError("Viewers cannot share this workspace.", 403);
  }
  if (role === "owner" && membership.role !== "owner") {
    throw new Gen2AccessError(
      "Only the owner can create an owner share link.",
      403,
    );
  }
  const token = createInviteToken();
  const createdAt = new Date();
  await getDatabase()
    .update(schema.gen2Workspaces)
    .set({
      activeInviteTokenHash: hashInviteToken(token),
      activeInviteCreatedByUserId: userId,
      activeInviteRole: role,
      activeInviteCreatedAt: createdAt,
      activeInviteExpiresAt: new Date(createdAt.getTime() + INVITE_TTL_MS),
      updatedAt: new Date(),
    })
    .where(eq(schema.gen2Workspaces.id, workspaceId));
  return {
    inviteUrl: `${origin}/gen2/join/${token}`,
    role,
  };
}

export async function getGen2ActiveShare(
  workspaceId: string,
  userId: string,
  origin: string,
) {
  await requireGen2Member(workspaceId, userId);
  const [workspace] = await getDatabase()
    .select({
      activeInviteTokenHash: schema.gen2Workspaces.activeInviteTokenHash,
      activeInviteRole: schema.gen2Workspaces.activeInviteRole,
      activeInviteExpiresAt: schema.gen2Workspaces.activeInviteExpiresAt,
    })
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, workspaceId))
    .limit(1);

  if (!workspace || !workspaceInviteIsActive(workspace.activeInviteExpiresAt)) {
    return null;
  }
  return {
    role: workspace.activeInviteRole ?? "editor",
    expiresAt: workspace.activeInviteExpiresAt?.toISOString(),
  };
}

export async function joinGen2Workspace(token: string, userId: string) {
  const tokenHash = hashInviteToken(token);
  const [workspace] = await getDatabase()
    .select({
      id: schema.gen2Workspaces.id,
      status: schema.gen2Workspaces.status,
      activeInviteExpiresAt: schema.gen2Workspaces.activeInviteExpiresAt,
      activeInviteRole: schema.gen2Workspaces.activeInviteRole,
    })
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.activeInviteTokenHash, tokenHash))
    .limit(1);
  if (
    !workspace ||
    workspace.status === "deleting" ||
    !workspaceInviteIsActive(workspace.activeInviteExpiresAt)
  ) {
    throw new Gen2AccessError("This invite link is no longer valid.", 404);
  }

  const role = workspace.activeInviteRole ?? "editor";

  if (role === "owner") {
    await assertComputeAvailable(userId);
    await getDatabase().transaction(async (tx) => {
      await tx
        .update(schema.gen2WorkspaceMembers)
        .set({ role: "editor" })
        .where(
          and(
            eq(schema.gen2WorkspaceMembers.workspaceId, workspace.id),
            eq(schema.gen2WorkspaceMembers.role, "owner"),
          ),
        );
      await tx
        .update(schema.gen2Workspaces)
        .set({ ownerId: userId, updatedAt: new Date() })
        .where(eq(schema.gen2Workspaces.id, workspace.id));
      await transferActiveComputeSession(tx, workspace.id, userId);
      const [existing] = await tx
        .select({ userId: schema.gen2WorkspaceMembers.userId })
        .from(schema.gen2WorkspaceMembers)
        .where(
          and(
            eq(schema.gen2WorkspaceMembers.workspaceId, workspace.id),
            eq(schema.gen2WorkspaceMembers.userId, userId),
          ),
        )
        .limit(1);
      if (existing) {
        await tx
          .update(schema.gen2WorkspaceMembers)
          .set({ role: "owner" })
          .where(
            and(
              eq(schema.gen2WorkspaceMembers.workspaceId, workspace.id),
              eq(schema.gen2WorkspaceMembers.userId, userId),
            ),
          );
      } else {
        await tx.insert(schema.gen2WorkspaceMembers).values({
          workspaceId: workspace.id,
          userId,
          role: "owner",
        });
      }
    });
  } else {
    await getDatabase()
      .insert(schema.gen2WorkspaceMembers)
      .values({
        workspaceId: workspace.id,
        userId,
        role,
      })
      .onConflictDoNothing();
  }

  return requireGen2Member(workspace.id, userId);
}

export async function getGen2WorkspaceMembers(
  workspaceId: string,
  userId: string,
): Promise<{ members: Gen2WorkspaceMember[]; ownerId: string }> {
  await requireGen2Member(workspaceId, userId);
  const [workspace] = await getDatabase()
    .select({ ownerId: schema.gen2Workspaces.ownerId })
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) throw new Gen2AccessError();

  const members = await getDatabase()
    .select({
      userId: schema.gen2WorkspaceMembers.userId,
      login: schema.users.login,
      name: schema.users.name,
      email: schema.users.email,
      avatarUrl: schema.users.avatarUrl,
      role: schema.gen2WorkspaceMembers.role,
      joinedAt: schema.gen2WorkspaceMembers.joinedAt,
    })
    .from(schema.gen2WorkspaceMembers)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.gen2WorkspaceMembers.userId),
    )
    .where(eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(schema.gen2WorkspaceMembers.joinedAt));

  return {
    ownerId: workspace.ownerId,
    members: members.map((m) => ({
      userId: m.userId,
      login: m.login,
      name: m.name,
      email: m.email,
      avatarUrl: m.avatarUrl,
      role: m.role,
      joinedAt: m.joinedAt ? m.joinedAt.toISOString() : undefined,
    })),
  };
}

export async function addGen2WorkspaceMember(
  workspaceId: string,
  currentUserId: string,
  emailOrLogin: string,
  role: Gen2WorkspaceRole,
): Promise<Gen2WorkspaceMember[]> {
  const caller = await requireGen2Member(workspaceId, currentUserId);
  if (caller.role === "viewer") {
    throw new Gen2AccessError("Viewers cannot add members.", 403);
  }
  if (role === "owner" && caller.role !== "owner") {
    throw new Gen2AccessError("Only the owner can transfer ownership.", 403);
  }

  const normalized = emailOrLogin.trim().toLowerCase();
  const [targetUser] = await getDatabase()
    .select({
      id: schema.users.id,
      login: schema.users.login,
      name: schema.users.name,
      email: schema.users.email,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.users)
    .where(
      or(
        eq(sql`lower(${schema.users.email})`, normalized),
        eq(sql`lower(${schema.users.login})`, normalized),
      ),
    )
    .limit(1);

  if (!targetUser) {
    throw new Gen2AccessError(
      `No user found with email or username "${emailOrLogin}".`,
      404,
    );
  }

  const database = getDatabase();
  if (role === "owner") {
    await assertComputeAvailable(targetUser.id);
    await database.transaction(async (tx) => {
      await tx
        .update(schema.gen2WorkspaceMembers)
        .set({ role: "editor" })
        .where(
          and(
            eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
            eq(schema.gen2WorkspaceMembers.role, "owner"),
          ),
        );
      await tx
        .update(schema.gen2Workspaces)
        .set({ ownerId: targetUser.id, updatedAt: new Date() })
        .where(eq(schema.gen2Workspaces.id, workspaceId));
      await transferActiveComputeSession(tx, workspaceId, targetUser.id);
      const [existing] = await tx
        .select({ userId: schema.gen2WorkspaceMembers.userId })
        .from(schema.gen2WorkspaceMembers)
        .where(
          and(
            eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
            eq(schema.gen2WorkspaceMembers.userId, targetUser.id),
          ),
        )
        .limit(1);
      if (existing) {
        await tx
          .update(schema.gen2WorkspaceMembers)
          .set({ role: "owner" })
          .where(
            and(
              eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
              eq(schema.gen2WorkspaceMembers.userId, targetUser.id),
            ),
          );
      } else {
        await tx.insert(schema.gen2WorkspaceMembers).values({
          workspaceId,
          userId: targetUser.id,
          role: "owner",
        });
      }
    });
  } else {
    const [existing] = await database
      .select({
        userId: schema.gen2WorkspaceMembers.userId,
        role: schema.gen2WorkspaceMembers.role,
      })
      .from(schema.gen2WorkspaceMembers)
      .where(
        and(
          eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
          eq(schema.gen2WorkspaceMembers.userId, targetUser.id),
        ),
      )
      .limit(1);

    if (existing) {
      if (existing.role === "owner") {
        throw new Gen2AccessError(
          "Cannot change role of the owner. Transfer ownership first.",
          400,
        );
      }
      await database
        .update(schema.gen2WorkspaceMembers)
        .set({ role })
        .where(
          and(
            eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
            eq(schema.gen2WorkspaceMembers.userId, targetUser.id),
          ),
        );
    } else {
      await database.insert(schema.gen2WorkspaceMembers).values({
        workspaceId,
        userId: targetUser.id,
        role,
      });
    }
  }

  const { members } = await getGen2WorkspaceMembers(workspaceId, currentUserId);
  return members;
}

export async function updateGen2WorkspaceMemberRole(
  workspaceId: string,
  currentUserId: string,
  targetUserId: string,
  role: Gen2WorkspaceRole,
): Promise<Gen2WorkspaceMember[]> {
  const caller = await requireGen2Member(workspaceId, currentUserId);
  if (caller.role !== "owner") {
    throw new Gen2AccessError(
      "Only the workspace owner can change member roles.",
      403,
    );
  }

  const database = getDatabase();
  const [targetMember] = await database
    .select({
      userId: schema.gen2WorkspaceMembers.userId,
      role: schema.gen2WorkspaceMembers.role,
    })
    .from(schema.gen2WorkspaceMembers)
    .where(
      and(
        eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
        eq(schema.gen2WorkspaceMembers.userId, targetUserId),
      ),
    )
    .limit(1);

  if (!targetMember) {
    throw new Gen2AccessError("Member not found in this workspace.", 404);
  }

  if (targetMember.role === "owner" && role !== "owner") {
    throw new Gen2AccessError(
      "Cannot demote the owner directly. Transfer ownership to another member.",
      400,
    );
  }

  if (role === "owner") {
    await assertComputeAvailable(targetUserId);
    await database.transaction(async (tx) => {
      await tx
        .update(schema.gen2WorkspaceMembers)
        .set({ role: "editor" })
        .where(
          and(
            eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
            eq(schema.gen2WorkspaceMembers.role, "owner"),
          ),
        );
      await tx
        .update(schema.gen2Workspaces)
        .set({ ownerId: targetUserId, updatedAt: new Date() })
        .where(eq(schema.gen2Workspaces.id, workspaceId));
      await transferActiveComputeSession(tx, workspaceId, targetUserId);
      await tx
        .update(schema.gen2WorkspaceMembers)
        .set({ role: "owner" })
        .where(
          and(
            eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
            eq(schema.gen2WorkspaceMembers.userId, targetUserId),
          ),
        );
    });
  } else {
    await database
      .update(schema.gen2WorkspaceMembers)
      .set({ role })
      .where(
        and(
          eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
          eq(schema.gen2WorkspaceMembers.userId, targetUserId),
        ),
      );
  }

  const { members } = await getGen2WorkspaceMembers(workspaceId, currentUserId);
  return members;
}

export async function removeGen2WorkspaceMember(
  workspaceId: string,
  currentUserId: string,
  targetUserId: string,
): Promise<Gen2WorkspaceMember[]> {
  const caller = await requireGen2Member(workspaceId, currentUserId);
  if (caller.role !== "owner" && currentUserId !== targetUserId) {
    throw new Gen2AccessError(
      "Only the workspace owner can remove other members.",
      403,
    );
  }

  const database = getDatabase();
  const [targetMember] = await database
    .select({
      role: schema.gen2WorkspaceMembers.role,
    })
    .from(schema.gen2WorkspaceMembers)
    .where(
      and(
        eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
        eq(schema.gen2WorkspaceMembers.userId, targetUserId),
      ),
    )
    .limit(1);

  if (!targetMember) {
    throw new Gen2AccessError("Member not found in this workspace.", 404);
  }

  if (targetMember.role === "owner") {
    throw new Gen2AccessError(
      "Cannot remove the workspace owner. Transfer ownership first.",
      400,
    );
  }

  const { revokeGen2SupersetMemberRuns } =
    await import("./superset-agent-runtime");
  await revokeGen2SupersetMemberRuns({
    workspaceId,
    memberId: targetUserId,
    actorId: currentUserId,
  });

  await database
    .delete(schema.gen2WorkspaceMembers)
    .where(
      and(
        eq(schema.gen2WorkspaceMembers.workspaceId, workspaceId),
        eq(schema.gen2WorkspaceMembers.userId, targetUserId),
      ),
    );

  const { members } = await getGen2WorkspaceMembers(
    workspaceId,
    currentUserId === targetUserId ? targetUserId : currentUserId,
  ).catch(() => ({ members: [] }));
  return members;
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

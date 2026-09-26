import "server-only";

import { and, count, eq } from "drizzle-orm";

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
import { ensureHostReady } from "../runtime/orchestrator-health";
import {
  destroySandbox,
  discardSandboxSnapshot,
} from "../runtime/orchestrator-sandbox";
import { GEN2_MAX_OWNED_WORKSPACES } from "./constants";
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
    // just to delete its database row. For all other states, purge the runtime
    // data before freeing the owner's workspace slot.
    if (currentStatus !== "pending") {
      try {
        await destroySandbox(workspaceId);
      } catch (error) {
        if (!isGen2HostUnreachable(error)) throw error;
        logEvent("warn", "gen2.workspace.delete_host_unreachable", {
          workspaceId,
          detail: error instanceof Error ? error.message : "unknown",
        });
        // The host may have deallocated while retaining the workspace disk.
        // Wake it so deletion can remove the snapshot rather than orphaning it.
        await ensureHostReady();
        await destroySandbox(workspaceId);
      }
      await discardSandboxSnapshot(workspaceId);
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
      status: schema.gen2Workspaces.status,
      activeInviteExpiresAt: schema.gen2Workspaces.activeInviteExpiresAt,
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

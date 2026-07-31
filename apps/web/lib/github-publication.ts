import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { schema } from "@codev/db";

import { appendWorkspaceEvent } from "./audit";
import { requireWorkspacePermission } from "./access";
import { getDatabase } from "./database";
import { getGitHubOctokit, getRepository } from "./github";
import { logEvent } from "./observability";
import { exportSandboxPublication } from "./orchestrator";

export class PublicationError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "PublicationError";
  }
}

interface PublicationTarget {
  workspaceId: string;
  userId: string;
  branchName: string;
  expectedHeadSha: string;
  requestId: string;
}

type GitHubTreeEntry = {
  path: string;
  mode: "100644" | "100755" | "120000";
  type: "blob";
  sha: string | null;
};

export function buildCreateTreeRequest(input: {
  owner: string;
  repo: string;
  baseTreeSha: string;
  tree: GitHubTreeEntry[];
}) {
  return {
    owner: input.owner,
    repo: input.repo,
    base_tree: input.baseTreeSha,
    tree: input.tree,
  };
}

export function buildDeletedTreeEntries(
  baseTree: ReadonlyArray<{
    path?: string;
    mode?: string;
    type?: string;
  }>,
  exportedPaths: ReadonlySet<string>,
): GitHubTreeEntry[] {
  return baseTree.flatMap((entry) => {
    if (entry.type !== "blob" || !entry.path || exportedPaths.has(entry.path)) {
      return [];
    }
    const mode =
      entry.mode === "100755" || entry.mode === "120000"
        ? entry.mode
        : "100644";
    return [{ path: entry.path, mode, type: "blob" as const, sha: null }];
  });
}

type PublishedBranch = typeof schema.publishedBranches.$inferSelect;

function publicationResponse(publication: PublishedBranch) {
  return {
    id: publication.id,
    workspaceId: publication.workspaceId,
    branchName: publication.branchName,
    status: publication.status,
    sourceHeadSha: publication.sourceHeadSha,
    baseSha: publication.baseSha,
    commitSha: publication.commitSha,
    htmlUrl: publication.htmlUrl,
    lastError: publication.lastError,
    publishedAt: publication.publishedAt?.toISOString() ?? null,
    updatedAt: publication.updatedAt.toISOString(),
  };
}

function refPath(branchName: string) {
  return branchName.split("/").map(encodeURIComponent).join("/");
}

async function reservePublication(input: PublicationTarget) {
  await requireWorkspacePermission(input.workspaceId, input.userId, "merge");
  return getDatabase().transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${input.workspaceId}))`,
    );
    const [target] = await transaction
      .select({
        repository: schema.workspaces.repository,
        repositoryId: schema.workspaces.githubRepositoryId,
        installationId: schema.workspaces.githubInstallationId,
        defaultBranch: schema.workspaces.defaultBranch,
        baseSha: schema.workspaces.baseSha,
        workspaceStatus: schema.workspaces.status,
        canMerge: schema.workspaceMembers.canMerge,
        integrationHeadSha: schema.worktrees.headSha,
      })
      .from(schema.workspaces)
      .innerJoin(
        schema.workspaceMembers,
        and(
          eq(schema.workspaceMembers.workspaceId, schema.workspaces.id),
          eq(schema.workspaceMembers.userId, input.userId),
        ),
      )
      .innerJoin(
        schema.worktrees,
        and(
          eq(schema.worktrees.workspaceId, schema.workspaces.id),
          eq(schema.worktrees.kind, "integration"),
        ),
      )
      .where(eq(schema.workspaces.id, input.workspaceId))
      .limit(1);

    if (!target) throw new PublicationError("Workspace not found.", 404);
    if (!target.canMerge) {
      throw new PublicationError(
        "Merge capability is required to publish.",
        403,
      );
    }
    if (target.workspaceStatus !== "ready") {
      throw new PublicationError(
        "The sandbox must be ready before publishing.",
      );
    }
    if (target.integrationHeadSha !== input.expectedHeadSha) {
      throw new PublicationError(
        "The integration branch advanced. Refresh before publishing.",
      );
    }
    if (input.branchName === target.defaultBranch) {
      throw new PublicationError("The default branch cannot be published.");
    }

    const activeAgents = await transaction
      .select({ id: schema.worktrees.id })
      .from(schema.worktrees)
      .where(
        and(
          eq(schema.worktrees.workspaceId, input.workspaceId),
          eq(schema.worktrees.kind, "agent"),
          inArray(schema.worktrees.status, ["active", "frozen"]),
        ),
      )
      .limit(1);
    if (activeAgents.length > 0) {
      throw new PublicationError(
        "Merge or discard active agent worktrees before publishing.",
      );
    }

    const [existing] = await transaction
      .select()
      .from(schema.publishedBranches)
      .where(
        and(
          eq(schema.publishedBranches.workspaceId, input.workspaceId),
          eq(schema.publishedBranches.branchName, input.branchName),
        ),
      )
      .limit(1);
    if (existing?.status === "published") {
      if (existing.sourceHeadSha !== input.expectedHeadSha) {
        throw new PublicationError(
          "That immutable publication branch already exists for another revision.",
        );
      }
      return { target, publication: existing, completed: true as const };
    }
    if (
      existing?.status === "pending" &&
      existing.updatedAt.getTime() > Date.now() - 5 * 60 * 1_000 &&
      existing.requestId !== input.requestId
    ) {
      throw new PublicationError("That publication is already in progress.");
    }
    if (existing && existing.sourceHeadSha !== input.expectedHeadSha) {
      throw new PublicationError(
        "That publication branch is reserved for another revision.",
      );
    }

    const values = {
      workspaceId: input.workspaceId,
      publishedBy: input.userId,
      branchName: input.branchName,
      status: "pending" as const,
      sourceHeadSha: input.expectedHeadSha,
      baseSha: target.baseSha,
      commitSha: existing?.commitSha ?? null,
      repositoryId: target.repositoryId,
      remoteRef: `refs/heads/${input.branchName}`,
      htmlUrl: null,
      requestId: input.requestId,
      lastError: null,
      publishedAt: null,
      updatedAt: new Date(),
    };
    const [publication] = existing
      ? await transaction
          .update(schema.publishedBranches)
          .set(values)
          .where(eq(schema.publishedBranches.id, existing.id))
          .returning()
      : await transaction
          .insert(schema.publishedBranches)
          .values(values)
          .returning();
    if (!publication) {
      throw new PublicationError("Could not reserve the publication.");
    }
    return { target, publication, completed: false as const };
  });
}

async function createGitHubCommit(
  userId: string,
  repository: string,
  baseSha: string,
  branchName: string,
  files: {
    path: string;
    mode: "100644" | "100755" | "120000";
    contentBase64: string;
  }[],
) {
  const octokit = await getGitHubOctokit(userId);
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new PublicationError("Invalid GitHub repository.");
  const treeEntries: GitHubTreeEntry[] = [];
  for (let offset = 0; offset < files.length; offset += 10) {
    const batch = files.slice(offset, offset + 10);
    const blobs = await Promise.all(
      batch.map((file) =>
        octokit.rest.git.createBlob({
          owner,
          repo,
          content: file.contentBase64,
          encoding: "base64",
        }),
      ),
    );
    treeEntries.push(
      ...batch.map((file, index) => ({
        path: file.path,
        mode: file.mode,
        type: "blob" as const,
        sha: blobs[index]?.data.sha ?? "",
      })),
    );
  }

  const baseCommit = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  });
  const baseTree = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: baseCommit.data.tree.sha,
    recursive: "1",
  });
  if (baseTree.data.truncated) {
    throw new PublicationError(
      "The GitHub base tree is too large for a CoDev publication.",
    );
  }
  const exportedPaths = new Set(files.map((file) => file.path));
  const deletedEntries = buildDeletedTreeEntries(
    baseTree.data.tree,
    exportedPaths,
  );
  const tree = await octokit.rest.git.createTree(
    buildCreateTreeRequest({
      owner,
      repo,
      baseTreeSha: baseCommit.data.tree.sha,
      tree: [...treeEntries, ...deletedEntries],
    }),
  );
  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: `Publish ${branchName} from CoDev`,
    tree: tree.data.sha,
    parents: [baseSha],
  });

  return commit.data.sha;
}

async function ensureGitHubRef(
  userId: string,
  repository: string,
  branchName: string,
  commitSha: string,
) {
  const octokit = await getGitHubOctokit(userId);
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new PublicationError("Invalid GitHub repository.");
  try {
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: commitSha,
    });
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number(error.status)
        : 0;
    if (status !== 422) throw error;
    const existing = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${refPath(branchName)}`,
    });
    if (existing.data.object.sha !== commitSha) {
      throw new PublicationError(
        "The remote branch already exists and CoDev will not overwrite it.",
      );
    }
  }
}

export async function publishWorkspaceBranch(input: PublicationTarget) {
  const startedAt = Date.now();
  const reservation = await reservePublication(input);
  if (reservation.completed) {
    return publicationResponse(reservation.publication);
  }

  try {
    const { repository } = await getRepository(
      input.userId,
      Number(reservation.target.installationId),
      Number(reservation.target.repositoryId),
    );
    if (
      repository.id !== Number(reservation.target.repositoryId) ||
      repository.full_name !== reservation.target.repository
    ) {
      throw new PublicationError(
        "The GitHub installation no longer exposes this repository.",
        403,
      );
    }

    let commitSha = reservation.publication.commitSha;
    if (!commitSha) {
      const exported = await exportSandboxPublication(
        input.workspaceId,
        input.expectedHeadSha,
      );
      const decodedBytes = exported.files.reduce(
        (total, file) =>
          total + Buffer.from(file.contentBase64, "base64").byteLength,
        0,
      );
      if (decodedBytes !== exported.totalBytes) {
        throw new PublicationError("The sandbox export failed validation.");
      }

      commitSha = await createGitHubCommit(
        input.userId,
        reservation.target.repository,
        reservation.target.baseSha,
        input.branchName,
        exported.files,
      );
      await getDatabase()
        .update(schema.publishedBranches)
        .set({ commitSha, updatedAt: new Date() })
        .where(eq(schema.publishedBranches.id, reservation.publication.id));
    }
    await ensureGitHubRef(
      input.userId,
      reservation.target.repository,
      input.branchName,
      commitSha,
    );
    const htmlUrl = `https://github.com/${reservation.target.repository}/tree/${encodeURIComponent(input.branchName)}`;
    const [publication] = await getDatabase()
      .update(schema.publishedBranches)
      .set({
        status: "published",
        commitSha,
        htmlUrl,
        lastError: null,
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.publishedBranches.id, reservation.publication.id))
      .returning();
    await appendWorkspaceEvent({
      workspaceId: input.workspaceId,
      actorId: input.userId,
      type: "publication.published",
      payload: {
        branchName: input.branchName,
        sourceHeadSha: input.expectedHeadSha,
        commitSha,
        requestId: input.requestId,
      },
    });
    logEvent("info", "publication.published", {
      requestId: input.requestId,
      workspaceId: input.workspaceId,
      durationMs: Date.now() - startedAt,
    });
    if (!publication) {
      throw new PublicationError("Could not finalize the publication.", 502);
    }
    return publicationResponse(publication);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 1_000)
        : "Publication failed.";
    await getDatabase()
      .update(schema.publishedBranches)
      .set({ status: "failed", lastError: message, updatedAt: new Date() })
      .where(eq(schema.publishedBranches.id, reservation.publication.id));
    await appendWorkspaceEvent({
      workspaceId: input.workspaceId,
      actorId: input.userId,
      type: "publication.failed",
      payload: {
        branchName: input.branchName,
        sourceHeadSha: input.expectedHeadSha,
        requestId: input.requestId,
        reason: message,
      },
    }).catch(() => undefined);
    logEvent("error", "publication.failed", {
      requestId: input.requestId,
      workspaceId: input.workspaceId,
      durationMs: Date.now() - startedAt,
      error: message,
    });
    throw error;
  }
}

export async function listWorkspacePublications(
  workspaceId: string,
  userId: string,
) {
  return getDatabase()
    .select({
      id: schema.publishedBranches.id,
      workspaceId: schema.publishedBranches.workspaceId,
      branchName: schema.publishedBranches.branchName,
      status: schema.publishedBranches.status,
      sourceHeadSha: schema.publishedBranches.sourceHeadSha,
      baseSha: schema.publishedBranches.baseSha,
      commitSha: schema.publishedBranches.commitSha,
      htmlUrl: schema.publishedBranches.htmlUrl,
      lastError: schema.publishedBranches.lastError,
      publishedAt: schema.publishedBranches.publishedAt,
      updatedAt: schema.publishedBranches.updatedAt,
    })
    .from(schema.publishedBranches)
    .innerJoin(
      schema.workspaceMembers,
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    )
    .where(eq(schema.publishedBranches.workspaceId, workspaceId))
    .orderBy(desc(schema.publishedBranches.updatedAt))
    .limit(20);
}

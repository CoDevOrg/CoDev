import "server-only";

import { eq } from "drizzle-orm";
import { schema } from "@codev/db";

import { githubRequest } from "../github/github";
import { listRepositoryTree } from "../github/repository-tree";
import { getDatabase } from "../platform/database";
import { listSupersetWorktrees } from "../runtime/orchestrator-superset-runtime";
import { repositoryTreeToEntries } from "./repository-file-list";

const PRIMARY_WORKTREE_ID = "main";

async function readWorkspaceBaseSha(workspaceId: string) {
  const [row] = await getDatabase()
    .select({ baseSha: schema.gen2Workspaces.baseSha })
    .from(schema.gen2Workspaces)
    .where(eq(schema.gen2Workspaces.id, workspaceId))
    .limit(1);
  return row?.baseSha ?? null;
}

/** The branch a non-primary worktree is on; null when detached or unknown. */
async function worktreeBranch(workspaceId: string, worktreeId: string) {
  const worktrees = await listSupersetWorktrees(workspaceId).catch(() => []);
  const branch = worktrees.find(
    (worktree) => worktree.worktreeId === worktreeId,
  )?.branch;
  return branch && branch !== "HEAD" ? branch : null;
}

/** The commit a branch points at on GitHub; null when it is only local. */
async function remoteBranchSha(
  userId: string,
  repository: string,
  branch: string,
) {
  const ref = branch.split("/").map(encodeURIComponent).join("/");
  try {
    const { object } = await githubRequest<{ object: { sha: string } }>(
      userId,
      `/repos/${repository}/git/ref/heads/${ref}`,
    );
    return object.sha;
  } catch {
    return null;
  }
}

/**
 * The connected repository's files from GitHub, for a checkout the guest
 * cannot list: it walks the whole tree and hides everything past 5,000
 * entries. The primary checkout reads the commit it was cloned at; another
 * worktree reads its branch's commit on GitHub, or that cloned commit when
 * the branch exists only on the machine. Files that exist only on the
 * machine are missing from either list.
 */
export async function listGen2RepositoryFiles(input: {
  workspaceId: string;
  userId: string;
  repository: string | undefined;
  worktreeId: string;
}) {
  const { workspaceId, userId, repository, worktreeId } = input;
  if (!repository) return null;
  const branch =
    worktreeId === PRIMARY_WORKTREE_ID
      ? null
      : await worktreeBranch(workspaceId, worktreeId);
  const sha =
    (branch ? await remoteBranchSha(userId, repository, branch) : null) ??
    (await readWorkspaceBaseSha(workspaceId));
  if (!sha) return null;
  try {
    return repositoryTreeToEntries(
      await listRepositoryTree(userId, repository, sha),
    );
  } catch {
    return null;
  }
}

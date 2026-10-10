import "server-only";
import type { Gen2RemoteBranchList } from "@codev/contracts";

import {
  GitHubApiError,
  githubRequest,
  resolveGithubConnection,
} from "../github/github";
import { requireGen2Member } from "./workspaces";

const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const REPOSITORY_NAME = /^[\w.-]+\/[\w.-]+$/;

function unavailable(
  reason: NonNullable<Gen2RemoteBranchList["unavailable"]>,
  defaultBranch: string | null = null,
): Gen2RemoteBranchList {
  return { branches: [], defaultBranch, truncated: false, unavailable: reason };
}

/** Default branch first, then the rest alphabetically. */
function ordered(names: string[], defaultBranch: string) {
  return [...new Set(names)].sort((a, b) =>
    a === defaultBranch
      ? -1
      : b === defaultBranch
        ? 1
        : a.localeCompare(b, "en", { sensitivity: "base" }),
  );
}

/**
 * Every branch of the workspace's repository on GitHub, read with the
 * caller's own GitHub authorization. A member whose GitHub account cannot see
 * the repository gets no branch names: the owner's access is never borrowed.
 */
export async function listGen2RemoteBranches(
  workspaceId: string,
  userId: string,
): Promise<Gen2RemoteBranchList> {
  const { repository } = await requireGen2Member(workspaceId, userId);
  if (!repository || !REPOSITORY_NAME.test(repository.fullName)) {
    return unavailable("no-repository");
  }
  const { defaultBranch } = repository;
  if (!(await resolveGithubConnection(userId)).connected) {
    return unavailable("github-not-connected", defaultBranch);
  }
  const names: string[] = [];
  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const batch = await githubRequest<{ name: string }[]>(
        userId,
        `/repos/${repository.fullName}/branches?per_page=${PAGE_SIZE}&page=${page}`,
      );
      names.push(...batch.map((branch) => branch.name));
      if (batch.length < PAGE_SIZE) {
        return {
          branches: ordered(names, defaultBranch).map((name) => ({ name })),
          defaultBranch,
          truncated: false,
          unavailable: null,
        };
      }
    }
  } catch (error) {
    if (
      error instanceof GitHubApiError &&
      [401, 403, 404].includes(error.status)
    ) {
      return unavailable("github-no-access", defaultBranch);
    }
    throw error;
  }
  return {
    branches: ordered(names, defaultBranch).map((name) => ({ name })),
    defaultBranch,
    truncated: true,
    unavailable: null,
  };
}

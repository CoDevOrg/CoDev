import "server-only";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { appendWorkspaceEvent } from "./audit";
import { getDatabase } from "./database";
import { GitHubApiError, githubRequest } from "./github";
import { logEvent } from "./observability";
import { getWorkspaceForMember } from "./workspaces";

export class PullRequestError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "PullRequestError";
  }
}

interface OpenPullRequestInput {
  workspaceId: string;
  userId: string;
  branchName: string;
  title: string;
  body?: string | undefined;
  requestId: string;
}

interface GitHubPullRequest {
  number: number;
  html_url: string;
  state: "open" | "closed";
}

export function pullRequestResponse(pullRequest: GitHubPullRequest) {
  return {
    number: pullRequest.number,
    htmlUrl: pullRequest.html_url,
    state: pullRequest.state,
  };
}

/**
 * Builds the GitHub "create pull request" request body. Kept pure so the
 * head/base wiring and default body are unit-testable without the network.
 */
export function buildCreatePullRequestBody(input: {
  branchName: string;
  defaultBranch: string;
  title: string;
  body?: string | undefined;
}) {
  if (input.branchName === input.defaultBranch) {
    throw new PullRequestError(
      "A pull request needs a head branch different from the base.",
    );
  }
  return {
    title: input.title,
    head: input.branchName,
    base: input.defaultBranch,
    body: input.body ?? "",
  };
}

export async function openWorkspacePullRequest(input: OpenPullRequestInput) {
  const startedAt = Date.now();
  const workspace = await getWorkspaceForMember(
    input.workspaceId,
    input.userId,
  );
  if (!workspace) throw new PullRequestError("Workspace not found.", 404);
  if (!workspace.canMerge) {
    throw new PullRequestError(
      "Merge capability is required to open a pull request.",
      403,
    );
  }

  const [publication] = await getDatabase()
    .select()
    .from(schema.publishedBranches)
    .where(
      and(
        eq(schema.publishedBranches.workspaceId, input.workspaceId),
        eq(schema.publishedBranches.branchName, input.branchName),
      ),
    )
    .limit(1);
  if (!publication || publication.status !== "published") {
    throw new PullRequestError(
      "Publish the branch before opening a pull request.",
    );
  }
  if (publication.pullRequestNumber && publication.pullRequestUrl) {
    return {
      number: publication.pullRequestNumber,
      htmlUrl: publication.pullRequestUrl,
      state: "open" as const,
    };
  }

  const body = buildCreatePullRequestBody({
    branchName: input.branchName,
    defaultBranch: workspace.defaultBranch,
    title: input.title,
    body: input.body,
  });

  let pullRequest: GitHubPullRequest;
  try {
    pullRequest = await githubRequest<GitHubPullRequest>(
      input.userId,
      `/repos/${workspace.repository}/pulls`,
      { method: "POST", body },
    );
  } catch (error) {
    // 422 means an open pull request already exists for this head branch.
    if (error instanceof GitHubApiError && error.status === 422) {
      const owner = workspace.repository.split("/")[0];
      const existing = await githubRequest<GitHubPullRequest[]>(
        input.userId,
        `/repos/${workspace.repository}/pulls?state=open&head=${owner}:${encodeURIComponent(
          input.branchName,
        )}`,
      );
      const [first] = existing;
      if (!first) throw error;
      pullRequest = first;
    } else {
      throw error;
    }
  }

  await getDatabase()
    .update(schema.publishedBranches)
    .set({
      pullRequestNumber: pullRequest.number,
      pullRequestUrl: pullRequest.html_url,
      updatedAt: new Date(),
    })
    .where(eq(schema.publishedBranches.id, publication.id));
  await appendWorkspaceEvent({
    workspaceId: input.workspaceId,
    actorId: input.userId,
    type: "pull_request.opened",
    payload: {
      branchName: input.branchName,
      number: pullRequest.number,
      requestId: input.requestId,
    },
  }).catch(() => undefined);
  logEvent("info", "pull_request.opened", {
    requestId: input.requestId,
    workspaceId: input.workspaceId,
    durationMs: Date.now() - startedAt,
  });
  return pullRequestResponse(pullRequest);
}

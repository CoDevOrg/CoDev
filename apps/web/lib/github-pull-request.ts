import "server-only";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { appendWorkspaceEvent } from "./audit";
import { requireWorkspacePermission } from "./access";
import { getDatabase } from "./database";
import { getGitHubOctokit, GitHubApiError } from "./github";
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
  await requireWorkspacePermission(input.workspaceId, input.userId, "merge");
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
    const [owner, repo] = workspace.repository.split("/");
    if (!owner || !repo)
      throw new PullRequestError("Invalid GitHub repository.");
    const octokit = await getGitHubOctokit(input.userId);
    const response = await octokit.rest.pulls.create({ owner, repo, ...body });
    pullRequest = {
      number: response.data.number,
      html_url: response.data.html_url,
      state: response.data.state,
    };
  } catch (error) {
    // 422 means an open pull request already exists for this head branch.
    const status =
      error instanceof GitHubApiError
        ? error.status
        : typeof error === "object" && error !== null && "status" in error
          ? Number(error.status)
          : 0;
    if (status === 422) {
      const owner = workspace.repository.split("/")[0];
      const repo = workspace.repository.split("/")[1];
      if (!owner || !repo)
        throw new PullRequestError("Invalid GitHub repository.");
      const octokit = await getGitHubOctokit(input.userId);
      const existing = await octokit.rest.pulls.list({
        owner,
        repo,
        state: "open",
        head: `${owner}:${input.branchName}`,
      });
      const first = existing.data[0];
      if (!first) throw error;
      pullRequest = {
        number: first.number,
        html_url: first.html_url,
        state: first.state === "open" ? "open" : "closed",
      };
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

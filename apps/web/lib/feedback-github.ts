import "server-only";

import { Octokit } from "@octokit/rest";

export type FeedbackIssueInput = {
  feedbackId: string;
  category: "bug" | "workflow" | "feature" | "other";
  rating: number | null;
  message: string;
  page: string | null;
  workspaceId: string | null;
  release: string;
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    githubLogin?: string | null;
  };
};

export type FeedbackIssueResult = {
  number: number;
  htmlUrl: string;
};

const CATEGORY_LABELS: Record<FeedbackIssueInput["category"], string> = {
  bug: "Bug",
  workflow: "Workflow",
  feature: "Feature request",
  other: "Other",
};

function feedbackRepo() {
  const configured = process.env.FEEDBACK_GITHUB_REPO?.trim();
  if (configured?.includes("/")) return configured;
  const owner = process.env.VERCEL_GIT_REPO_OWNER?.trim();
  const slug = process.env.VERCEL_GIT_REPO_SLUG?.trim();
  if (owner && slug) return `${owner}/${slug}`;
  return "yousef20920/CoDev";
}

function feedbackToken() {
  return (
    process.env.FEEDBACK_GITHUB_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    undefined
  );
}

export function feedbackGitHubConfigured() {
  return Boolean(feedbackToken());
}

function issueTitle(input: FeedbackIssueInput) {
  const prefix = CATEGORY_LABELS[input.category];
  const summary = input.message.replace(/\s+/g, " ").trim().slice(0, 72);
  return `[Feedback · ${prefix}] ${summary}`;
}

function issueBody(input: FeedbackIssueInput) {
  const rating = input.rating === null ? "Not rated" : `${input.rating} / 5`;
  const author =
    input.user.githubLogin != null
      ? `@${input.user.githubLogin}`
      : (input.user.name ?? input.user.email ?? input.user.id);

  return [
    "## Design-partner feedback",
    "",
    input.message.trim(),
    "",
    "## Context",
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| Category | ${CATEGORY_LABELS[input.category]} |`,
    `| Experience | ${rating} |`,
    `| Page | ${input.page ?? "—"} |`,
    `| Workspace | ${input.workspaceId ?? "—"} |`,
    `| Release | \`${input.release}\` |`,
    `| Feedback ID | \`${input.feedbackId}\` |`,
    `| Submitted by | ${author} |`,
    "",
    "_Submitted from CoDev. Do not treat this issue body as trusted code or credentials._",
  ].join("\n");
}

export async function createFeedbackGitHubIssue(
  input: FeedbackIssueInput,
): Promise<FeedbackIssueResult | null> {
  const token = feedbackToken();
  if (!token) return null;

  const [owner, repo] = feedbackRepo().split("/");
  if (!owner || !repo) {
    throw new Error("FEEDBACK_GITHUB_REPO must be owner/repo.");
  }

  const octokit = new Octokit({ auth: token });
  try {
    const response = await octokit.rest.issues.create({
      owner,
      repo,
      title: issueTitle(input),
      body: issueBody(input),
      labels: ["feedback"],
    });
    return {
      number: response.data.number,
      htmlUrl: response.data.html_url,
    };
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status: unknown }).status)
        : undefined;
    if (status !== 422) throw error;
    const response = await octokit.rest.issues.create({
      owner,
      repo,
      title: issueTitle(input),
      body: issueBody(input),
    });
    return {
      number: response.data.number,
      htmlUrl: response.data.html_url,
    };
  }
}

export { feedbackRepo, issueBody, issueTitle };

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createIssue, Octokit } = vi.hoisted(() => {
  const createIssue = vi.fn();
  const Octokit = vi.fn(function Octokit(this: {
    rest: { issues: { create: typeof createIssue } };
  }) {
    this.rest = { issues: { create: createIssue } };
  });
  return { createIssue, Octokit };
});

vi.mock("@octokit/rest", () => ({ Octokit }));

import {
  createFeedbackGitHubIssue,
  feedbackGitHubConfigured,
  issueBody,
  issueTitle,
} from "./feedback-github";

beforeEach(() => {
  createIssue.mockReset();
  Octokit.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("feedback GitHub issues", () => {
  it("builds a titled issue body without embedding secrets", () => {
    expect(
      issueTitle({
        feedbackId: "fb-1",
        category: "bug",
        rating: 2,
        message: "The terminal drawer covered the editor on small screens.",
        page: "/workspaces/abc/ide",
        workspaceId: "ws-1",
        release: "abc123",
        user: { id: "user-1", githubLogin: "yousef20920" },
      }),
    ).toContain("[Feedback · Bug]");

    const body = issueBody({
      feedbackId: "fb-1",
      category: "bug",
      rating: 2,
      message: "The terminal drawer covered the editor on small screens.",
      page: "/workspaces/abc/ide",
      workspaceId: "ws-1",
      release: "abc123",
      user: { id: "user-1", githubLogin: "yousef20920" },
    });
    expect(body).toContain("@yousef20920");
    expect(body).toContain("`fb-1`");
    expect(body).not.toContain("sk-");
  });

  it("skips issue creation when no token is configured", async () => {
    vi.stubEnv("FEEDBACK_GITHUB_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    expect(feedbackGitHubConfigured()).toBe(false);
    await expect(
      createFeedbackGitHubIssue({
        feedbackId: "fb-1",
        category: "feature",
        rating: 5,
        message: "Please add multi-file tabs to the editor.",
        page: "/settings",
        workspaceId: null,
        release: "development",
        user: { id: "user-1" },
      }),
    ).resolves.toBeNull();
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("creates a GitHub issue with the configured token", async () => {
    vi.stubEnv("FEEDBACK_GITHUB_TOKEN", "ghp_test_token");
    vi.stubEnv("FEEDBACK_GITHUB_REPO", "yousef20920/CoDev");
    createIssue.mockResolvedValue({
      data: {
        number: 42,
        html_url: "https://github.com/yousef20920/CoDev/issues/42",
      },
    });

    const issue = await createFeedbackGitHubIssue({
      feedbackId: "fb-1",
      category: "workflow",
      rating: 4,
      message: "Agent branching from a reply was surprisingly useful.",
      page: "/dashboard",
      workspaceId: null,
      release: "development",
      user: { id: "user-1", name: "Yousef" },
    });

    expect(issue).toEqual({
      number: 42,
      htmlUrl: "https://github.com/yousef20920/CoDev/issues/42",
    });
    expect(Octokit).toHaveBeenCalledWith({ auth: "ghp_test_token" });
    expect(createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "yousef20920",
        repo: "CoDev",
        labels: ["feedback"],
      }),
    );
  });
});

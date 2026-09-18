import { describe, expect, it } from "vitest";

import {
  buildCreatePullRequestBody,
  PullRequestError,
  pullRequestResponse,
} from "./github-pull-request";

describe("buildCreatePullRequestBody", () => {
  it("targets the default branch from the published head branch", () => {
    expect(
      buildCreatePullRequestBody({
        branchName: "codev/design-partner-demo",
        defaultBranch: "main",
        title: "CoDev: codev/design-partner-demo",
        body: "Ship it",
      }),
    ).toEqual({
      title: "CoDev: codev/design-partner-demo",
      head: "codev/design-partner-demo",
      base: "main",
      body: "Ship it",
    });
  });

  it("defaults the body to an empty string", () => {
    expect(
      buildCreatePullRequestBody({
        branchName: "codev/demo",
        defaultBranch: "main",
        title: "CoDev: codev/demo",
      }).body,
    ).toBe("");
  });

  it("rejects opening a pull request from the base branch onto itself", () => {
    expect(() =>
      buildCreatePullRequestBody({
        branchName: "main",
        defaultBranch: "main",
        title: "CoDev: main",
      }),
    ).toThrow(PullRequestError);
  });
});

describe("pullRequestResponse", () => {
  it("maps the GitHub payload to the workspace pull request shape", () => {
    expect(
      pullRequestResponse({
        number: 7,
        html_url: "https://github.com/acme/app/pull/7",
        state: "open",
      }),
    ).toEqual({
      number: 7,
      htmlUrl: "https://github.com/acme/app/pull/7",
      state: "open",
    });
  });
});

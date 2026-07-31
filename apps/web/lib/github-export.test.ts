import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { select: vi.fn() },
  getOpenAIApiKey: vi.fn(),
  openAiCreate: vi.fn(),
  publishWorkspaceBranch: vi.fn(),
  openWorkspacePullRequest: vi.fn(),
}));

vi.mock("./database", () => ({
  getDatabase: () => mocks.database,
}));
vi.mock("./credentials", () => ({
  getOpenAIApiKey: mocks.getOpenAIApiKey,
}));
vi.mock("./github-publication", () => ({
  publishWorkspaceBranch: mocks.publishWorkspaceBranch,
}));
vi.mock("./github-pull-request", () => ({
  openWorkspacePullRequest: mocks.openWorkspacePullRequest,
}));
vi.mock("openai", () => ({
  default: class OpenAI {
    readonly responses = { create: mocks.openAiCreate };
  },
}));

import {
  buildExportActivity,
  exportWorkspaceToPullRequest,
} from "./github-export";

function selectResult<T>(value: T) {
  const terminal = {
    limit: async () => value,
    orderBy: () => ({ limit: async () => value }),
  };
  return {
    from: () => ({
      where: () => terminal,
    }),
  };
}

function queueExportDatabaseReads() {
  mocks.database.select
    .mockReturnValueOnce(selectResult([{ repository: "acme/demo" }]))
    .mockReturnValueOnce(
      selectResult([
        {
          type: "USER_PROMPT",
          payload: { promptText: "Implement the feature" },
        },
      ]),
    );
}

beforeEach(() => {
  vi.clearAllMocks();
  queueExportDatabaseReads();
  mocks.getOpenAIApiKey.mockResolvedValue("test-openai-key");
  mocks.openAiCreate.mockResolvedValue({
    output_text:
      "## Summary\n\nImplemented the feature.\n\n## Tests\n\n- Unit tests",
  });
  mocks.publishWorkspaceBranch.mockResolvedValue({
    branchName: "codev/feature",
    commitSha: "commit-sha",
    status: "published",
  });
  mocks.openWorkspacePullRequest.mockResolvedValue({
    number: 42,
    htmlUrl: "https://github.com/acme/demo/pull/42",
    state: "open",
  });
});

describe("GitHub export activity", () => {
  it("keeps chronological context within a bounded AI input", () => {
    const activity = buildExportActivity([
      { type: "TOOL_CALL_RESULT", payload: { output: "latest" } },
      { type: "AGENT_THOUGHT", payload: { output: "x".repeat(10_000) } },
      { type: "USER_PROMPT", payload: { prompt: "oldest" } },
    ]);

    expect(activity.map((event) => event.type)).toEqual([
      "USER_PROMPT",
      "AGENT_THOUGHT",
      "TOOL_CALL_RESULT",
    ]);
    expect(JSON.stringify(activity).length).toBeLessThanOrEqual(80_000);
    expect(String(activity[1]?.payload.output)).toHaveLength(4_000);
  });

  it("coordinates AI summary, branch publication, and PR creation", async () => {
    const result = await exportWorkspaceToPullRequest({
      workspaceId: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
      userId: "2f2387ed-4a63-4b05-88cc-266d65f7b82b",
      branchName: "codev/feature",
      expectedHeadSha: "a".repeat(40),
      requestId: "request-1",
    });

    expect(mocks.openAiCreate).toHaveBeenCalledOnce();
    expect(mocks.publishWorkspaceBranch).toHaveBeenCalledWith({
      workspaceId: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
      userId: "2f2387ed-4a63-4b05-88cc-266d65f7b82b",
      branchName: "codev/feature",
      expectedHeadSha: "a".repeat(40),
      requestId: "request-1",
    });
    expect(mocks.openWorkspacePullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
        branchName: "codev/feature",
        title: "CoDev: codev/feature",
        requestId: "request-1",
        body: expect.stringContaining("Implemented the feature."),
      }),
    );
    expect(result).toMatchObject({
      summary: expect.stringContaining("Implemented the feature."),
      pullRequest: { number: 42 },
    });
  });
});

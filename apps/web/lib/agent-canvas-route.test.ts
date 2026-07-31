import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiError: vi.fn((error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  ),
  createOpenAI: vi.fn(),
  getApiUser: vi.fn(),
  getOpenAIApiKey: vi.fn(),
  readSandboxFile: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  searchSandboxFiles: vi.fn(),
  ensureWorkspaceRuntimeReady: vi.fn(),
  stepCountIs: vi.fn(() => "step-count"),
  streamText: vi.fn(),
  tool: vi.fn((definition: unknown) => definition),
  appendWorkspaceStateEvent: vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: mocks.createOpenAI }));
vi.mock("ai", () => ({
  stepCountIs: mocks.stepCountIs,
  streamText: mocks.streamText,
  tool: mocks.tool,
}));
vi.mock("@/lib/api", () => ({
  apiError: mocks.apiError,
  getApiUser: mocks.getApiUser,
}));
vi.mock("@/lib/access", () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
}));
vi.mock("@/lib/credentials", () => ({
  getOpenAIApiKey: mocks.getOpenAIApiKey,
}));
vi.mock("@/lib/runtime-resume", () => ({
  ensureWorkspaceRuntimeReady: mocks.ensureWorkspaceRuntimeReady,
}));
vi.mock("@/lib/orchestrator", () => ({
  readSandboxFile: mocks.readSandboxFile,
  searchSandboxFiles: mocks.searchSandboxFiles,
}));
vi.mock("@/lib/workspace-state", () => ({
  appendWorkspaceStateEvent: mocks.appendWorkspaceStateEvent,
}));

import { POST } from "@/app/api/workspaces/[workspaceId]/agents/stream/route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";

async function* streamParts() {
  yield { type: "text-delta", text: "I inspected the file. " };
  yield {
    type: "tool-call",
    toolCallId: "call-diff",
    toolName: "proposeFileChange",
    input: {
      filePath: "src/app.tsx",
      diffContent: "@@ -1 +1 @@\n-old\n+new\n",
    },
  };
  yield {
    type: "tool-result",
    toolCallId: "call-diff",
    toolName: "proposeFileChange",
    output: {
      filePath: "src/app.tsx",
      diffContent: "@@ -1 +1 @@\n-old\n+new\n",
      status: "proposal ready for review",
    },
  };
}

function request(body: Record<string, unknown>, signal?: AbortSignal) {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
  if (signal) init.signal = signal;
  return new Request("https://codev.test", init);
}

describe("agent canvas stream route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({
      id: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
      name: "Ada",
      email: "ada@example.test",
      image: null,
    });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.getOpenAIApiKey.mockResolvedValue("test-key");
    mocks.createOpenAI.mockReturnValue(() => "mock-model");
    mocks.readSandboxFile.mockImplementation(
      async (_workspaceId: string, path: string) => {
        if (path !== "README.md") throw new Error("file not found");
        return {
          path: "README.md",
          contents: "workspace contents",
          revision: "revision-1",
        };
      },
    );
    mocks.searchSandboxFiles.mockResolvedValue("src/app.tsx:1:old");
    mocks.streamText.mockReturnValue({ fullStream: streamParts() });
  });

  afterEach(() => vi.resetAllMocks());

  it("streams canonical events for text, tools, and proposed diffs", async () => {
    const response = await POST(
      request({ prompt: "Inspect README.md and propose a diff." }),
      { params: Promise.resolve({ workspaceId }) },
    );

    expect(response.status).toBe(200);
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event: { type: string } });
    expect(events.map((entry) => entry.event.type)).toEqual([
      "USER_PROMPT",
      "AGENT_THOUGHT",
      "TOOL_CALL_INIT",
      "FILE_DIFF_PROPOSED",
      "TOOL_CALL_RESULT",
    ]);

    const options = mocks.streamText.mock.calls[0]?.[0] as {
      tools: {
        inspectWorkspace: {
          execute(input: { query: string }): Promise<unknown>;
        };
        proposeFileChange: {
          execute(input: {
            filePath: string;
            diffContent: string;
          }): Promise<unknown>;
        };
      };
      abortSignal: AbortSignal;
    };
    await expect(
      options.tools.inspectWorkspace.execute({ query: "README.md" }),
    ).resolves.toMatchObject({
      status: "file read",
      path: "README.md",
      revision: "revision-1",
    });
    await expect(
      options.tools.inspectWorkspace.execute({ query: "TODO" }),
    ).resolves.toMatchObject({ status: "search complete" });
    await expect(
      options.tools.proposeFileChange.execute({
        filePath: "src/app.tsx",
        diffContent: "diff",
      }),
    ).resolves.toMatchObject({ status: "proposal ready for review" });
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("emits a pause event when the request is already aborted", async () => {
    mocks.streamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "not delivered" };
      })(),
    });
    const controller = new AbortController();
    controller.abort();

    const response = await POST(
      request({ prompt: "Pause this agent." }, controller.signal),
      { params: Promise.resolve({ workspaceId }) },
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event: { type: string } });
    expect(events.at(-1)?.event.type).toBe("INTERVENTION_PAUSE");
  });
});

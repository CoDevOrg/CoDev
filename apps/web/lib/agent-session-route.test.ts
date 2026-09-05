import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discardAgentWorktree: vi.fn(),
  ensureWorkspaceRuntimeReady: vi.fn(),
  getApiUser: vi.fn(),
}));

vi.mock("@/lib/agent-review", () => ({
  discardAgentWorktree: mocks.discardAgentWorktree,
  ReviewActionError: class ReviewActionError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  getApiUser: mocks.getApiUser,
}));
vi.mock("@/lib/orchestrator", () => ({
  OrchestratorError: class OrchestratorError extends Error {},
}));
vi.mock("@/lib/runtime-resume", () => ({
  ensureWorkspaceRuntimeReady: mocks.ensureWorkspaceRuntimeReady,
}));

import { DELETE } from "@/app/api/workspaces/[workspaceId]/agents/[sessionId]/route";

describe("DELETE agent session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiUser.mockResolvedValue({ id: "user-1" });
    mocks.ensureWorkspaceRuntimeReady.mockResolvedValue(undefined);
    mocks.discardAgentWorktree.mockResolvedValue({ status: "discarded" });
  });

  it("delegates legacy deletion to the audited proposal-discard lifecycle", async () => {
    const response = await DELETE(new Request("https://codev.test"), {
      params: Promise.resolve({
        workspaceId: "workspace-1",
        sessionId: "session-1",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "discarded" });
    expect(mocks.ensureWorkspaceRuntimeReady).toHaveBeenCalledWith(
      "workspace-1",
      "user-1",
    );
    expect(mocks.discardAgentWorktree).toHaveBeenCalledWith(
      "workspace-1",
      "session-1",
      "user-1",
    );
  });
});

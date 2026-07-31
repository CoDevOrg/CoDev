import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendWorkspaceEvent: vi.fn().mockResolvedValue(undefined),
  appendWorkspaceStateEvent: vi.fn().mockResolvedValue(undefined),
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  getApiUser: mocks.getApiUser,
}));
vi.mock("@/lib/access", () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
}));
vi.mock("@/lib/audit", () => ({
  appendWorkspaceEvent: mocks.appendWorkspaceEvent,
}));
vi.mock("@/lib/workspace-state", () => ({
  appendWorkspaceStateEvent: mocks.appendWorkspaceStateEvent,
}));

import { POST } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const sessionId = "8f4dd3e4-63a9-4b64-a9e7-97e0c25c77c5";
const reviewerId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";

function request(body: Record<string, unknown>) {
  return new Request("https://codev.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("workspace review comments", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({
      id: reviewerId,
      name: "Reviewer",
      email: "reviewer@example.test",
      image: null,
    });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
  });

  afterEach(() => vi.resetAllMocks());

  it("persists an inline comment without starting an agent", async () => {
    const response = await POST(
      request({
        body: "Please add a regression test.",
        filePath: "src/auth.ts",
        lineNumber: 42,
        sessionId,
      }),
      { params: Promise.resolve({ workspaceId }) },
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      comment: {
        type: string;
        sessionId: string;
        payload: Record<string, unknown>;
      };
    };
    expect(payload.comment.type).toBe("COMMENT_ADDED");
    expect(payload.comment.sessionId).toBe(sessionId);
    expect(payload.comment.payload).toMatchObject({
      commentText: "Please add a regression test.",
      filePath: "src/auth.ts",
      metadata: { lineNumber: 42 },
    });
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      workspaceId,
      reviewerId,
      "review",
    );
    expect(mocks.appendWorkspaceStateEvent).toHaveBeenCalledOnce();
    expect(mocks.appendWorkspaceEvent).toHaveBeenCalledOnce();
  });

  it("returns the OpenFGA denial to a non-reviewer", async () => {
    mocks.requireWorkspacePermission.mockRejectedValue(
      Object.assign(new Error("OpenFGA denied review permission."), {
        status: 403,
      }),
    );

    const response = await POST(
      request({ body: "This should be denied.", sessionId }),
      { params: Promise.resolve({ workspaceId }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.appendWorkspaceStateEvent).not.toHaveBeenCalled();
  });
});

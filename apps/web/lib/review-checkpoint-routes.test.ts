import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  loadReviewSnapshot: vi.fn(),
  applyWorkspaceReviewAction: vi.fn(),
  ensureWorkspaceRuntimeReady: vi.fn(),
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
vi.mock("@/lib/review-checkpoint-server", () => ({
  loadReviewSnapshot: mocks.loadReviewSnapshot,
  applyWorkspaceReviewAction: mocks.applyWorkspaceReviewAction,
}));
vi.mock("@/lib/runtime-resume", () => ({
  ensureWorkspaceRuntimeReady: mocks.ensureWorkspaceRuntimeReady,
}));

import {
  GET as getReviews,
  POST as prepareReview,
} from "@/app/api/workspaces/[workspaceId]/agents/reviews/route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const sessionId = "aa22f527-8992-4814-95a2-070f1b01fc9f";
const snapshot = {
  viewer: { id: userId, name: "Jordan Lee", canReview: true },
  checkpoints: [
    {
      sessionId,
      slot: 1,
      prepared: true,
      summary: "2 paths changed · 1 text file · 1 binary file",
      paths: [
        { path: "README.md", kind: "modified", detail: "+1 −0 line" },
        {
          path: "assets/logo.png",
          kind: "binary",
          detail: "Binary file · content omitted",
        },
      ],
    },
  ],
};

describe("review checkpoint routes", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId, name: "Jordan Lee" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.loadReviewSnapshot.mockResolvedValue(snapshot);
    mocks.applyWorkspaceReviewAction.mockResolvedValue(snapshot);
    mocks.ensureWorkspaceRuntimeReady.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the workspace review snapshot", async () => {
    const response = await getReviews(new Request("http://codev.test"), {
      params: Promise.resolve({ workspaceId }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(JSON.stringify(snapshot)).not.toContain("diff --git ");
  });

  it("prepares a review checkpoint and returns the mapped snapshot", async () => {
    const response = await prepareReview(
      new Request("http://codev.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(mocks.ensureWorkspaceRuntimeReady).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "review",
    );
    expect(mocks.applyWorkspaceReviewAction).toHaveBeenCalledWith(
      workspaceId,
      { id: userId, name: "Jordan Lee" },
      { sessionId },
    );
  });

  it("merges a current checkpoint through the review action", async () => {
    const integrated = {
      ...snapshot,
      approval: { state: "integrated", blocked: false, mergeStarted: false },
      integration: {
        actor: "Jordan Lee",
        role: "Maintainer",
        event: "agent.review_merged",
        mergedHeadSha: "d".repeat(40),
      },
    };
    mocks.applyWorkspaceReviewAction.mockResolvedValueOnce(integrated);
    const response = await prepareReview(
      new Request("http://codev.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "merge", sessionId }),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(integrated);
    expect(mocks.applyWorkspaceReviewAction).toHaveBeenCalledWith(
      workspaceId,
      { id: userId, name: "Jordan Lee" },
      { action: "merge", sessionId },
    );
  });

  it("advances the integration head through the review action", async () => {
    const stale = {
      ...snapshot,
      approval: { state: "stale", blocked: true, mergeStarted: false },
    };
    mocks.applyWorkspaceReviewAction.mockResolvedValueOnce(stale);
    const response = await prepareReview(
      new Request("http://codev.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "advance" }),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(stale);
  });

  it("requires authentication", async () => {
    mocks.getApiUser.mockResolvedValueOnce(null);
    const response = await getReviews(new Request("http://codev.test"), {
      params: Promise.resolve({ workspaceId }),
    });
    expect(response.status).toBe(401);
  });
});

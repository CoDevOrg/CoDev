import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  loadActivityAuditSnapshot: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  getApiUser: mocks.getApiUser,
  getApiUserAnyAuth: mocks.getApiUser,
}));
vi.mock("@/lib/access", () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
}));
vi.mock("@/lib/activity-audit-server", () => ({
  loadActivityAuditSnapshot: mocks.loadActivityAuditSnapshot,
}));

import { GET as getActivity } from "@/app/api/workspaces/[workspaceId]/events/route";

const workspaceId = "bed7a975-eccf-4742-85c6-cab41ce02830";
const snapshot = {
  viewer: { id: "user-1", name: "CoDev Test Jordan" },
  events: [
    {
      id: "event-1",
      sequence: 12,
      type: "agent.review_merged",
      actor: "CoDev Test Jordan",
      summary: "CoDev Test Jordan integrated a reviewed checkpoint",
      jump: { kind: "diff", surface: "checks", label: "Open Checks · diff" },
    },
  ],
  filters: { kind: "diff", query: "review" },
  filtered: [
    {
      id: "event-1",
      type: "agent.review_merged",
      jump: { surface: "checks" },
    },
  ],
};

describe("activity audit route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: "user-1", name: "Jordan" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.loadActivityAuditSnapshot.mockResolvedValue(snapshot);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the durable activity snapshot for the requested filter", async () => {
    const response = await getActivity(
      new Request(
        `http://codev.test/api/workspaces/${workspaceId}/events?kind=diff&query=review`,
      ),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(mocks.loadActivityAuditSnapshot).toHaveBeenCalledWith(
      workspaceId,
      { id: "user-1", name: "Jordan" },
      { kind: "diff", query: "review" },
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  loadWorkboardSnapshot: vi.fn(),
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
vi.mock("@/lib/workboard-server", () => ({
  loadWorkboardSnapshot: mocks.loadWorkboardSnapshot,
}));

import { GET as getWorkboard } from "@/app/api/workspaces/[workspaceId]/agents/workboard/route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const snapshot = {
  viewer: { id: userId, name: "Jordan Lee", canCoSteer: true },
  capacity: { maxActiveSessions: 3, activeSessions: 3, availableSlots: 0 },
  slots: [
    { slot: 1, occupied: true, assignment: "Repository map" },
    { slot: 2, occupied: true, assignment: "Presence replay" },
    { slot: 3, occupied: true, assignment: "Session recovery" },
  ],
  rejection: null,
};

describe("workboard routes", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId, name: "Jordan Lee" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.loadWorkboardSnapshot.mockResolvedValue(snapshot);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the three-slot workboard snapshot", async () => {
    const response = await getWorkboard(new Request("http://codev.test"), {
      params: Promise.resolve({ workspaceId }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(mocks.loadWorkboardSnapshot).toHaveBeenCalledWith(workspaceId, {
      id: userId,
      name: "Jordan Lee",
    });
  });

  it("requires authentication", async () => {
    mocks.getApiUser.mockResolvedValueOnce(null);
    const response = await getWorkboard(new Request("http://codev.test"), {
      params: Promise.resolve({ workspaceId }),
    });
    expect(response.status).toBe(401);
  });
});

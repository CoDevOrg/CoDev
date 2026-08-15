import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  loadPathClaimsSnapshot: vi.fn(),
  createWorkspacePathClaim: vi.fn(),
  reassignWorkspacePathClaim: vi.fn(),
  cancelWorkspacePathClaim: vi.fn(),
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
vi.mock("@/lib/path-claims-server", () => ({
  loadPathClaimsSnapshot: mocks.loadPathClaimsSnapshot,
  createWorkspacePathClaim: mocks.createWorkspacePathClaim,
  reassignWorkspacePathClaim: mocks.reassignWorkspacePathClaim,
  cancelWorkspacePathClaim: mocks.cancelWorkspacePathClaim,
}));

import {
  GET as getClaims,
  POST as createClaim,
} from "@/app/api/workspaces/[workspaceId]/agents/claims/route";
import { POST as reassignClaim } from "@/app/api/workspaces/[workspaceId]/agents/claims/reassign/route";
import { POST as cancelClaim } from "@/app/api/workspaces/[workspaceId]/agents/claims/cancel/route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const snapshot = {
  viewer: { id: userId, name: "Jordan Lee", canCoSteer: true },
  groups: [
    {
      path: "README.md",
      contested: true,
      warningTitle: "Contested overlap · no silent overwrite",
    },
  ],
  notice: null,
};

describe("path claim routes", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId, name: "Jordan Lee" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.loadPathClaimsSnapshot.mockResolvedValue(snapshot);
    mocks.createWorkspacePathClaim.mockResolvedValue(snapshot);
    mocks.reassignWorkspacePathClaim.mockResolvedValue({
      ...snapshot,
      notice: "Claim reassigned to Agent slot 2",
    });
    mocks.cancelWorkspacePathClaim.mockResolvedValue({
      ...snapshot,
      notice: "Overlapping claim cancelled",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the workspace path-claim snapshot", async () => {
    const response = await getClaims(new Request("http://codev.test"), {
      params: Promise.resolve({ workspaceId }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
  });

  it("creates a claim and returns the updated snapshot", async () => {
    const response = await createClaim(
      new Request("http://codev.test", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "aa22f527-8992-4814-95a2-070f1b01fc9f",
        }),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(201);
    expect(mocks.createWorkspacePathClaim).toHaveBeenCalled();
  });

  it("reassigns a contested claim to the kept slot", async () => {
    const response = await reassignClaim(
      new Request("http://codev.test", {
        method: "POST",
        body: JSON.stringify({
          claimId: "aa22f527-8992-4814-95a2-070f1b01fc9f",
        }),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      notice: "Claim reassigned to Agent slot 2",
    });
  });

  it("cancels the overlapping claim", async () => {
    const response = await cancelClaim(
      new Request("http://codev.test", {
        method: "POST",
        body: JSON.stringify({
          claimId: "aa22f527-8992-4814-95a2-070f1b01fc9f",
        }),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      notice: "Overlapping claim cancelled",
    });
  });

  it("requires authentication", async () => {
    mocks.getApiUser.mockResolvedValueOnce(null);
    const response = await getClaims(new Request("http://codev.test"), {
      params: Promise.resolve({ workspaceId }),
    });
    expect(response.status).toBe(401);
  });
});

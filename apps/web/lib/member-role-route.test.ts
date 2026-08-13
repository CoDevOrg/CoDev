import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  updateMemberAccessRole: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  getApiUser: mocks.getApiUser,
}));
vi.mock("@/lib/workspaces", () => ({
  listWorkspaceMembers: mocks.listWorkspaceMembers,
  updateMemberAccessRole: mocks.updateMemberAccessRole,
}));

import { PATCH } from "@/app/api/workspaces/[workspaceId]/members/[userId]/route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const ownerUserId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const memberUserId = "c1f9fe13-6881-44a6-adbd-96bc5a946afa";

function request(body: Record<string, unknown>) {
  return new Request("https://codev.test", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("workspace member role route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: ownerUserId });
    mocks.updateMemberAccessRole.mockResolvedValue(undefined);
    mocks.listWorkspaceMembers.mockResolvedValue([
      {
        userId: memberUserId,
        login: "jordan",
        name: "Jordan Lee",
        role: "member",
        accessRole: "viewer",
      },
    ]);
  });

  afterEach(() => vi.resetAllMocks());

  it("updates a member role and returns the refreshed membership list", async () => {
    const response = await PATCH(request({ accessRole: "viewer" }), {
      params: Promise.resolve({ workspaceId, userId: memberUserId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      members: [
        {
          userId: memberUserId,
          login: "jordan",
          name: "Jordan Lee",
          role: "member",
          accessRole: "viewer",
        },
      ],
    });
    expect(mocks.updateMemberAccessRole).toHaveBeenCalledWith(
      workspaceId,
      memberUserId,
      ownerUserId,
      "viewer",
    );
    expect(mocks.listWorkspaceMembers).toHaveBeenCalledWith(workspaceId);
  });

  it("rejects an unsupported access role without mutating membership", async () => {
    const response = await PATCH(request({ accessRole: "owner" }), {
      params: Promise.resolve({ workspaceId, userId: memberUserId }),
    });

    expect(response.status).toBe(400);
    expect(mocks.updateMemberAccessRole).not.toHaveBeenCalled();
  });

  it("requires an authenticated owner before accepting the update", async () => {
    mocks.getApiUser.mockResolvedValue(null);

    const response = await PATCH(request({ accessRole: "viewer" }), {
      params: Promise.resolve({ workspaceId, userId: memberUserId }),
    });

    expect(response.status).toBe(401);
    expect(mocks.updateMemberAccessRole).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  updateRole: vi.fn(),
  removeMember: vi.fn(),
}));

vi.mock("@/lib/http/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  getApiUser: mocks.getApiUser,
  getApiUserAnyAuth: mocks.getApiUser,
}));

vi.mock("@/lib/gen2/workspaces", () => ({
  updateGen2WorkspaceMemberRole: mocks.updateRole,
  removeGen2WorkspaceMember: mocks.removeMember,
}));

import { DELETE, PATCH } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const targetMemberId = "33333333-3333-4333-8333-333333333333";
const params = Promise.resolve({ workspaceId, memberUserId: targetMemberId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/members/${targetMemberId}`;

describe("gen2 member item route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
  });
  afterEach(() => vi.resetAllMocks());

  it("updates a member role", async () => {
    mocks.updateRole.mockResolvedValue([
      {
        userId: targetMemberId,
        login: "member-user",
        name: "Member",
        role: "viewer",
      },
    ]);

    const response = await PATCH(
      new Request(url, {
        method: "PATCH",
        headers: {
          origin: "https://codev.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "viewer" }),
      }),
      { params },
    );

    expect(mocks.updateRole).toHaveBeenCalledWith(
      workspaceId,
      userId,
      targetMemberId,
      "viewer",
    );
    expect(response.status).toBe(200);
  });

  it("removes a member", async () => {
    mocks.removeMember.mockResolvedValue([]);

    const response = await DELETE(
      new Request(url, {
        method: "DELETE",
        headers: { origin: "https://codev.test" },
      }),
      {
        params,
      },
    );

    expect(mocks.removeMember).toHaveBeenCalledWith(
      workspaceId,
      userId,
      targetMemberId,
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as { members: unknown };
    expect(data.members).toEqual([]);
  });
});

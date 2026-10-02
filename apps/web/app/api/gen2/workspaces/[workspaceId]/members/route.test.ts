import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  getMembers: vi.fn(),
  addMember: vi.fn(),
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
  getGen2WorkspaceMembers: mocks.getMembers,
  addGen2WorkspaceMember: mocks.addMember,
}));

import { GET, POST } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const params = Promise.resolve({ workspaceId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/members`;

describe("gen2 members route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
  });
  afterEach(() => vi.resetAllMocks());

  it("lists members of the workspace", async () => {
    mocks.getMembers.mockResolvedValue({
      ownerId: userId,
      members: [
        {
          userId,
          login: "owner-user",
          name: "Owner",
          role: "owner",
        },
      ],
    });

    const response = await GET(new Request(url), { params });
    expect(mocks.getMembers).toHaveBeenCalledWith(workspaceId, userId);
    expect(await response.json()).toEqual({
      ownerId: userId,
      members: [
        {
          userId,
          login: "owner-user",
          name: "Owner",
          role: "owner",
        },
      ],
    });
  });

  it("adds a member by email or login with the specified role", async () => {
    mocks.addMember.mockResolvedValue([
      {
        userId,
        login: "owner-user",
        name: "Owner",
        role: "owner",
      },
      {
        userId: "new-user-id",
        login: "newuser",
        name: "New User",
        email: "newuser@example.com",
        role: "viewer",
      },
    ]);

    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          emailOrLogin: "newuser@example.com",
          role: "viewer",
        }),
      }),
      { params },
    );

    expect(mocks.addMember).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "newuser@example.com",
      "viewer",
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.members).toHaveLength(2);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  database: { select: vi.fn() },
  listWorkspacePresenceEntries: vi.fn(),
  recordOrcaActiveFile: vi.fn(),
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
vi.mock("@/lib/database", () => ({ getDatabase: () => mocks.database }));
vi.mock("@/lib/collaboration-server", () => ({
  listWorkspacePresenceEntries: mocks.listWorkspacePresenceEntries,
  recordOrcaActiveFile: mocks.recordOrcaActiveFile,
}));

import { GET } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";

describe("workspace presence route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.database.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              id: userId,
              login: "alex",
              name: "Alex Morgan",
              avatarUrl: null,
            },
          ]),
        }),
      }),
    });
    mocks.listWorkspacePresenceEntries.mockResolvedValue([
      {
        connectionId: "orca:private-user-id",
        lastSeenAt: "2026-08-14T14:00:00.000Z",
        user: {
          id: userId,
          login: "alex",
          name: "Alex Morgan",
          avatarUrl: null,
        },
        path: "src/hello.ts",
      },
    ]);
  });

  afterEach(() => vi.resetAllMocks());

  it("returns only the authorized collaborator identity and active file", async () => {
    const response = await GET(new Request("https://codev.test"), {
      params: Promise.resolve({ workspaceId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      members: [
        {
          user: {
            id: userId,
            login: "alex",
            name: "Alex Morgan",
            avatarUrl: null,
          },
          path: "src/hello.ts",
        },
      ],
    });
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "view",
    );
  });
});

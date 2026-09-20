import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceForMember: vi.fn(),
  prepareOrcaWorkspace: vi.fn(),
}));

vi.mock("@/lib/http/api-route", () => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  },
  withWorkspace: (
    _permission: string,
    handler: (input: {
      user: { id: string };
      workspaceId: string;
    }) => Promise<Response>,
  ) => {
    return async (
      _request: Request,
      context: { params: Promise<{ workspaceId: string }> },
    ) => {
      const { workspaceId } = await context.params;
      return handler({ user: { id: userId }, workspaceId });
    };
  },
}));
vi.mock("@/lib/runtime/orca-host", () => ({
  prepareOrcaWorkspace: mocks.prepareOrcaWorkspace,
}));
vi.mock("@/lib/workspaces/workspaces", () => ({
  getWorkspaceForMember: mocks.getWorkspaceForMember,
}));

import { POST } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";

const workspace = {
  id: workspaceId,
  repository: "CoDevOrg/CoDev",
  repositoryVisibility: "private",
  defaultBranch: "main",
};

describe("workspace prepare route", () => {
  beforeEach(() => {
    mocks.getWorkspaceForMember.mockResolvedValue(workspace);
    mocks.prepareOrcaWorkspace.mockResolvedValue("host-starting");
  });

  afterEach(() => vi.resetAllMocks());

  it("returns 202 while the host is still starting", async () => {
    const response = await POST(
      new Request(`https://codev.test/api/workspaces/${workspaceId}/prepare`, {
        method: "POST",
      }),
      { params: Promise.resolve({ workspaceId }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ state: "host-starting" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getWorkspaceForMember).toHaveBeenCalledWith(
      workspaceId,
      userId,
    );
    expect(mocks.prepareOrcaWorkspace).toHaveBeenCalledWith(workspace, userId);
  });

  it("returns 200 after repository preparation completes", async () => {
    mocks.prepareOrcaWorkspace.mockResolvedValueOnce("prepared");

    const response = await POST(
      new Request(`https://codev.test/api/workspaces/${workspaceId}/prepare`, {
        method: "POST",
      }),
      { params: Promise.resolve({ workspaceId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "prepared" });
  });
});

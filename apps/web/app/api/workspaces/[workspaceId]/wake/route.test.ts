import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  requestHostWake: vi.fn(),
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
vi.mock("@/lib/auth/access", () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
}));
vi.mock("@/lib/runtime/host", () => ({
  requestHostWake: mocks.requestHostWake,
}));

import { POST } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";

describe("workspace wake route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.requestHostWake.mockResolvedValue("starting");
  });

  afterEach(() => vi.resetAllMocks());

  it("wakes only the host and returns 202 while it starts", async () => {
    const response = await POST(
      new Request(`https://codev.test/api/workspaces/${workspaceId}/wake`, {
        method: "POST",
      }),
      { params: Promise.resolve({ workspaceId }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ state: "starting" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "view",
    );
    expect(mocks.requestHostWake).toHaveBeenCalledWith(1);
  });

  it("returns 200 when the host is already running", async () => {
    mocks.requestHostWake.mockResolvedValueOnce("running");

    const response = await POST(
      new Request(`https://codev.test/api/workspaces/${workspaceId}/wake`, {
        method: "POST",
      }),
      { params: Promise.resolve({ workspaceId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "running" });
  });

  it("requires a signed-in member before touching workspace access", async () => {
    mocks.getApiUser.mockResolvedValueOnce(null);

    const response = await POST(
      new Request(`https://codev.test/api/workspaces/${workspaceId}/wake`, {
        method: "POST",
      }),
      { params: Promise.resolve({ workspaceId }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.requireWorkspacePermission).not.toHaveBeenCalled();
    expect(mocks.requestHostWake).not.toHaveBeenCalled();
  });
});

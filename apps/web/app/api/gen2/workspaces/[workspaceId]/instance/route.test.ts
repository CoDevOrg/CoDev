import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  detail: vi.fn(),
}));

vi.mock("@/lib/http/api-route", () => ({
  withUser: (
    handler: (input: {
      user: { id: string };
      params: { workspaceId: string };
    }) => Promise<Response>,
  ) => {
    return async (
      _request: Request,
      context: { params: Promise<{ workspaceId: string }> },
    ) =>
      handler({
        user: { id: "user-1" },
        params: await context.params,
      });
  },
}));
vi.mock("@/lib/gen2/instance", () => ({
  ensureGen2Instance: mocks.ensure,
  stopGen2Instance: vi.fn(),
}));
vi.mock("@/lib/gen2/workspaces", () => ({
  getGen2WorkspaceDetail: mocks.detail,
}));

import { maxDuration, POST } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const workspace = {
  id: workspaceId,
  status: "ready",
  sandboxId: "sandbox-1",
};

describe("gen2 instance route", () => {
  beforeEach(() => {
    mocks.ensure.mockResolvedValue(workspace);
    mocks.detail.mockResolvedValue(workspace);
  });

  afterEach(() => vi.resetAllMocks());

  it("allows host wake and Firecracker startup their bounded route budget", () => {
    expect(maxDuration).toBe(300);
  });

  it("returns the ready workspace after startup", async () => {
    const response = await POST(
      new Request(
        `https://codev.test/api/gen2/workspaces/${workspaceId}/instance`,
        {
          method: "POST",
        },
      ),
      { params: Promise.resolve({ workspaceId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ workspace });
    expect(mocks.ensure).toHaveBeenCalledWith(workspaceId, "user-1");
    expect(mocks.detail).toHaveBeenCalledWith(workspaceId, "user-1");
  });

  it("returns 202 when another member still owns provisioning", async () => {
    mocks.ensure.mockResolvedValueOnce({
      ...workspace,
      status: "provisioning",
    });
    mocks.detail.mockResolvedValueOnce({
      ...workspace,
      status: "provisioning",
      sandboxId: null,
    });

    const response = await POST(
      new Request(
        `https://codev.test/api/gen2/workspaces/${workspaceId}/instance`,
        {
          method: "POST",
        },
      ),
      { params: Promise.resolve({ workspaceId }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      workspace: { ...workspace, status: "provisioning", sandboxId: null },
    });
  });

  it("uses the returned workspace state when a concurrent stop wins", async () => {
    mocks.detail.mockResolvedValueOnce({
      ...workspace,
      status: "stopped",
      sandboxId: null,
    });

    const response = await POST(
      new Request(
        `https://codev.test/api/gen2/workspaces/${workspaceId}/instance`,
        {
          method: "POST",
        },
      ),
      { params: Promise.resolve({ workspaceId }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      workspace: { ...workspace, status: "stopped", sandboxId: null },
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  loadProviderConnectionSnapshot: vi.fn(),
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
vi.mock("@/lib/provider-connection-server", () => ({
  loadProviderConnectionSnapshot: mocks.loadProviderConnectionSnapshot,
}));

import { GET as getConnections } from "@/app/api/workspaces/[workspaceId]/connections/route";

const workspaceId = "bed7a975-eccf-4742-85c6-cab41ce02830";
const snapshot = {
  viewer: { id: "user-1", name: "CoDev Test Jordan" },
  connections: [
    {
      provider: "openai",
      label: "OpenAI",
      status: "connected",
      credentialType: "API_KEY",
      lastFour: "9kQ2",
      suppliedBy: "CoDev Test Jordan",
      scope: "personal",
    },
    {
      provider: "anthropic",
      label: "Anthropic",
      status: "not_connected",
      credentialType: null,
      lastFour: null,
      suppliedBy: null,
      scope: "personal",
    },
  ],
};

describe("provider connection route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: "user-1", name: "Jordan" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.loadProviderConnectionSnapshot.mockResolvedValue(snapshot);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the redacted connection snapshot for the signed-in member", async () => {
    const response = await getConnections(
      new Request(
        `http://codev.test/api/workspaces/${workspaceId}/connections`,
      ),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(mocks.loadProviderConnectionSnapshot).toHaveBeenCalledWith({
      id: "user-1",
      name: "Jordan",
    });
  });
});

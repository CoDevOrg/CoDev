import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  loadProviderConnectionSnapshot: vi.fn(),
  savePersonalProviderConnection: vi.fn(),
  revokePersonalProviderConnection: vi.fn(),
  completeFixtureOpenAiOAuth: vi.fn(),
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
  savePersonalProviderConnection: mocks.savePersonalProviderConnection,
  revokePersonalProviderConnection: mocks.revokePersonalProviderConnection,
  completeFixtureOpenAiOAuth: mocks.completeFixtureOpenAiOAuth,
}));

import {
  DELETE as deleteConnection,
  GET as getConnections,
  POST as postConnection,
  PUT as putConnection,
} from "@/app/api/workspaces/[workspaceId]/connections/route";

const workspaceId = "bed7a975-eccf-4742-85c6-cab41ce02830";
const fixtureKey = "sk-test-codev-f62-fixture-key0001";
const connectedSnapshot = {
  viewer: { id: "user-1", name: "CoDev Test Jordan" },
  connections: [
    {
      provider: "openai",
      label: "OpenAI",
      status: "connected",
      credentialType: "API_KEY",
      lastFour: "0001",
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
const oauthConnectedSnapshot = {
  viewer: { id: "user-1", name: "CoDev Test Jordan" },
  connections: [
    {
      provider: "openai",
      label: "OpenAI",
      status: "not_connected",
      credentialType: null,
      lastFour: null,
      suppliedBy: null,
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
  oauth: {
    provider: "openai",
    status: "available",
    label: "Connect with OpenAI",
    summary: "Connected · fixture callback",
    reason:
      "OpenAI is connected through the CoDev fixture OAuth callback. ChatGPT consent was not used.",
  },
};
const disconnectedSnapshot = {
  ...connectedSnapshot,
  connections: connectedSnapshot.connections.map((row) =>
    row.provider === "openai"
      ? {
          ...row,
          status: "not_connected",
          credentialType: null,
          lastFour: null,
          suppliedBy: null,
        }
      : row,
  ),
};

describe("provider connection route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: "user-1", name: "Jordan" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.loadProviderConnectionSnapshot.mockResolvedValue(
      disconnectedSnapshot,
    );
    mocks.savePersonalProviderConnection.mockResolvedValue(connectedSnapshot);
    mocks.revokePersonalProviderConnection.mockResolvedValue(
      disconnectedSnapshot,
    );
    mocks.completeFixtureOpenAiOAuth.mockResolvedValue(oauthConnectedSnapshot);
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
    await expect(response.json()).resolves.toEqual(disconnectedSnapshot);
    expect(mocks.loadProviderConnectionSnapshot).toHaveBeenCalledWith({
      id: "user-1",
      name: "Jordan",
    });
  });

  it("saves a personal API key and returns only redacted connection status", async () => {
    const response = await putConnection(
      new Request(
        `http://codev.test/api/workspaces/${workspaceId}/connections`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "openai", apiKey: fixtureKey }),
        },
      ),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(connectedSnapshot);
    expect(JSON.stringify(payload)).not.toContain(fixtureKey);
    expect(mocks.savePersonalProviderConnection).toHaveBeenCalledWith(
      { id: "user-1", name: "Jordan" },
      "openai",
      fixtureKey,
    );
  });

  it("completes OpenAI OAuth through the fixture callback without echoing tokens", async () => {
    const response = await postConnection(
      new Request(
        `http://codev.test/api/workspaces/${workspaceId}/connections`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "openai", oauth: "fixture" }),
        },
      ),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(oauthConnectedSnapshot);
    expect(JSON.stringify(payload)).not.toMatch(
      /oa-test-codev|auth\.openai\.com|authorize/i,
    );
    expect(mocks.completeFixtureOpenAiOAuth).toHaveBeenCalledWith({
      id: "user-1",
      name: "Jordan",
    });
  });

  it("revokes a personal API key and returns the disconnected snapshot", async () => {
    const response = await deleteConnection(
      new Request(
        `http://codev.test/api/workspaces/${workspaceId}/connections?provider=openai`,
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(disconnectedSnapshot);
    expect(mocks.revokePersonalProviderConnection).toHaveBeenCalledWith(
      { id: "user-1", name: "Jordan" },
      "openai",
    );
  });
});

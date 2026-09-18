import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  createWorkspaceRealtimeReader: vi.fn(),
  latestWorkspaceRealtimeStreamId: vi.fn(),
  readWorkspaceRealtimeEvents: vi.fn(),
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
vi.mock("@/lib/workspaces/workspace-realtime", () => ({
  createWorkspaceRealtimeReader: mocks.createWorkspaceRealtimeReader,
  latestWorkspaceRealtimeStreamId: mocks.latestWorkspaceRealtimeStreamId,
  readWorkspaceRealtimeEvents: mocks.readWorkspaceRealtimeEvents,
}));

import { GET } from "./route";

const workspaceId = "bed7a975-eccf-4742-85c6-cab41ce02830";

describe("workspace realtime stream route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: "user-1", name: "Jordan" });
    mocks.requireWorkspacePermission.mockResolvedValue(undefined);
    mocks.createWorkspaceRealtimeReader.mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed Redis cursors before opening a subscriber", async () => {
    const response = await GET(
      new Request(
        `http://codev.test/api/workspaces/${workspaceId}/events/stream?after=not-a-stream-id`,
      ),
      { params: Promise.resolve({ workspaceId }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.createWorkspaceRealtimeReader).not.toHaveBeenCalled();
  });

  it("returns a service-unavailable response when Redis is not configured", async () => {
    const response = await GET(
      new Request(
        `http://codev.test/api/workspaces/${workspaceId}/events/stream`,
      ),
      { params: Promise.resolve({ workspaceId }) },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Realtime stream is unavailable.",
    });
  });
});

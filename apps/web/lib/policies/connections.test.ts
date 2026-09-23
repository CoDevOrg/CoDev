import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requirePermission: vi.fn() }));

vi.mock("./workspace", () => ({
  requireWorkspacePermission: (...args: unknown[]) =>
    mocks.requirePermission(...args),
}));

import {
  redactConnectionStatus,
  requireConnectionStatusView,
  requireOwnConnectionManagement,
} from "./connections";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const otherUserId = "33333333-3333-4333-8333-333333333333";
const access = { role: "owner", capabilities: {} };

describe("connection policy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requirePermission.mockResolvedValue(access);
  });

  it("allows only redacted connection status to be read", async () => {
    await expect(
      requireConnectionStatusView(workspaceId, userId),
    ).resolves.toBe(access);
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "connection.viewStatus",
    );
    expect(redactConnectionStatus(true)).toEqual({ connected: true });
    expect(redactConnectionStatus(false)).toEqual({ connected: false });
  });

  it("allows a member to manage only their own connection", async () => {
    await expect(
      requireOwnConnectionManagement({
        workspaceId,
        userId,
        connectionOwnerId: userId,
      }),
    ).resolves.toBe(access);
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "connection.manageOwn",
    );
  });

  it("does not let even a workspace owner manage another member's connection", async () => {
    await expect(
      requireOwnConnectionManagement({
        workspaceId,
        userId,
        connectionOwnerId: otherUserId,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

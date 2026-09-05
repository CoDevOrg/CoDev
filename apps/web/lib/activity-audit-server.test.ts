import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listWorkspaceEvents: vi.fn(),
  listWorkspaceMembers: vi.fn(),
}));

vi.mock("./audit", () => ({
  listWorkspaceEvents: mocks.listWorkspaceEvents,
}));
vi.mock("./workspaces", () => ({
  listWorkspaceMembers: mocks.listWorkspaceMembers,
}));

import { loadActivityAuditSnapshot } from "./activity-audit-server";

const user = { id: "user-1", name: "Jordan" };
const createdAt = new Date("2026-08-15T19:28:00.000Z");

function event(sequence: number) {
  return {
    id: `event-${sequence}`,
    sequence,
    type: "workspace.synced",
    actorId: "user-1",
    payload: {},
    createdAt,
  };
}

describe("loadActivityAuditSnapshot pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listWorkspaceMembers.mockResolvedValue([]);
  });

  it("passes the requested limit and cursor through to listWorkspaceEvents", async () => {
    mocks.listWorkspaceEvents.mockResolvedValue([event(5), event(4)]);

    await loadActivityAuditSnapshot("workspace-1", user, {
      limit: 2,
      beforeSequence: 6,
    });

    expect(mocks.listWorkspaceEvents).toHaveBeenCalledWith(
      "workspace-1",
      "user-1",
      2,
      6,
    );
  });

  it("returns the oldest sequence as nextCursor when the page is full", async () => {
    mocks.listWorkspaceEvents.mockResolvedValue([event(5), event(4)]);

    const snapshot = await loadActivityAuditSnapshot("workspace-1", user, {
      limit: 2,
    });

    expect(snapshot.nextCursor).toBe(4);
  });

  it("returns null nextCursor once a page comes back short of the limit", async () => {
    mocks.listWorkspaceEvents.mockResolvedValue([event(5)]);

    const snapshot = await loadActivityAuditSnapshot("workspace-1", user, {
      limit: 2,
    });

    expect(snapshot.nextCursor).toBeNull();
  });
});

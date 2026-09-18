import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendWorkspaceEvent: vi.fn(),
}));

vi.mock("./audit", () => mocks);

import { appendPresenceEvent } from "./presence-events";

const workspaceId = "f2100000-0000-4000-8000-000000000001";
const userId = "f2100000-0000-4000-8000-000000000011";

describe("appendPresenceEvent", () => {
  it("persists a typed presence event with the audit sequence", async () => {
    mocks.appendWorkspaceEvent.mockResolvedValueOnce({
      id: "f2100000-0000-4000-8000-000000000101",
      sequence: 12,
      createdAt: new Date("2026-08-11T17:20:00.000Z"),
    });

    const event = await appendPresenceEvent({
      workspaceId,
      type: "presence.cursor.changed",
      data: {
        userId,
        path: "src/hello.ts",
        cursor: { anchor: 24, head: 30 },
      },
    });

    expect(mocks.appendWorkspaceEvent).toHaveBeenCalledWith({
      workspaceId,
      actorId: userId,
      type: "presence.cursor.changed",
      payload: {
        userId,
        path: "src/hello.ts",
        cursor: { anchor: 24, head: 30 },
      },
    });
    expect(event).toEqual({
      id: "f2100000-0000-4000-8000-000000000101",
      workspaceId,
      sequence: 12,
      createdAt: "2026-08-11T17:20:00.000Z",
      type: "presence.cursor.changed",
      data: {
        userId,
        path: "src/hello.ts",
        cursor: { anchor: 24, head: 30 },
      },
    });
  });
});

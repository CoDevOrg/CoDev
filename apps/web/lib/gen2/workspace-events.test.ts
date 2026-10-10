import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ publish: vi.fn(), log: vi.fn() }));
vi.mock("./collaboration-rooms", () => ({ publishStamped: mocks.publish }));
vi.mock("../platform/observability", () => ({ logEvent: mocks.log }));

import {
  publishGen2MembersChanged,
  publishGen2WorkspaceEvent,
} from "./workspace-events";

const id = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const message = (body: string) => ({
  id,
  role: "assistant" as const,
  body,
  items: null,
  authorUserId: null,
  createdAt: "2026-07-28T12:00:00.000Z",
});

function published() {
  const build = mocks.publish.mock.calls.at(-1)![1] as (s: string) => {
    event: unknown;
  };
  return build("1-0").event;
}

describe("publishGen2WorkspaceEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pushes a long message as a pointer so members refetch it", async () => {
    await publishGen2WorkspaceEvent(id, {
      kind: "chat.message",
      chatId: id,
      messageId: id,
      message: message("x".repeat(70_000)),
      updatedAt: "2026-07-28T12:00:00.000Z",
    });
    expect(published()).toMatchObject({ kind: "chat.message", message: null });
  });

  it("never fails the operation that caused it", async () => {
    mocks.publish.mockRejectedValueOnce(new Error("redis down"));
    await expect(
      publishGen2WorkspaceEvent(id, { kind: "worktrees.changed" }),
    ).resolves.toBeUndefined();
    expect(mocks.log).toHaveBeenCalledWith(
      "warn",
      "gen2.realtime.publish_failed",
      expect.objectContaining({ kind: "worktrees.changed" }),
    );
  });

  it("never sends member email addresses", async () => {
    await publishGen2MembersChanged(id, [
      {
        userId: id,
        login: "octo",
        name: null,
        email: "o@example.com",
        role: "editor",
      },
    ]);
    expect(JSON.stringify(published())).not.toContain("o@example.com");
  });
});

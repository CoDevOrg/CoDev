import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  loadMany: vi.fn(),
  reconcile: vi.fn(),
  publish: vi.fn(),
  lock: vi.fn(),
}));

vi.mock("./collaboration-documents", () => ({
  loadGen2Document: mocks.load,
  loadGen2Documents: mocks.loadMany,
  reconcileGen2Document: mocks.reconcile,
}));
vi.mock("./collaboration-rooms", () => ({ publish: mocks.publish }));
vi.mock("./collaboration-redis", async () => {
  const { DocumentBusyError } = await vi.importActual<
    typeof import("./collaboration-redis")
  >("./collaboration-redis");
  return { DocumentBusyError, withDocumentLock: mocks.lock };
});
vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));
vi.mock("./collaboration-autosave", () => ({
  announceWrite: vi.fn(),
  writeSharedFile: vi.fn(),
}));

import { DocumentBusyError } from "./collaboration-redis";
import { reconcileGen2CollaborationPaths } from "./collaboration-events";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "c010bd2c-a3c1-438f-acef-166287a3b1cb";
const actor = {
  kind: "agent" as const,
  sessionId: "s1",
  provider: "claude" as const,
  ownerUserId: userId,
  chatId: userId,
};

describe("reconcileGen2CollaborationPaths", () => {
  it("reconciles open documents in the agent's worktree under the lock", async () => {
    const snapshot = {
      workspaceId,
      worktreeId: "feature-auth",
      path: "src/login.ts",
    };
    mocks.loadMany.mockResolvedValue([snapshot]);
    mocks.load.mockResolvedValue(snapshot);
    mocks.lock.mockImplementation((_r, _w, _p, action) => action());
    mocks.reconcile.mockResolvedValue({
      snapshot,
      event: {
        type: "reconciled",
        path: snapshot.path,
        revision: "rev-2",
        update: "AQID",
        range: { from: 4, to: 9 },
      },
    });

    const ranges = await reconcileGen2CollaborationPaths({
      workspaceId,
      userId,
      worktreeId: "feature-auth",
      paths: [snapshot.path, "closed.ts"],
      actor,
    });

    expect(mocks.loadMany).toHaveBeenCalledWith(workspaceId, "feature-auth", [
      snapshot.path,
      "closed.ts",
    ]);
    expect(mocks.lock).toHaveBeenCalledWith(
      `gen2:${workspaceId}`,
      "feature-auth",
      snapshot.path,
      expect.any(Function),
      { waitMs: 5_000 },
    );
    expect(mocks.publish).toHaveBeenCalledWith(`gen2:${workspaceId}`, {
      type: "reconciled",
      worktreeId: "feature-auth",
      path: snapshot.path,
      revision: "rev-2",
      source: "filesystem",
      update: "AQID",
      actor,
      range: { from: 4, to: 9 },
    });
    expect(ranges.get(snapshot.path)).toEqual({ from: 4, to: 9 });
  });

  it("skips a document a member is editing instead of failing the turn", async () => {
    vi.clearAllMocks();
    mocks.loadMany.mockResolvedValue([{ path: "busy.ts" }]);
    mocks.lock.mockRejectedValue(new DocumentBusyError());
    await expect(
      reconcileGen2CollaborationPaths({
        workspaceId,
        userId,
        worktreeId: "main",
        paths: ["busy.ts"],
      }),
    ).resolves.toEqual(new Map());
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

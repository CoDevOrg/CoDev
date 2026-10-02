import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  reconcile: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("./collaboration-documents", () => ({
  loadGen2Document: mocks.load,
  reconcileGen2Document: mocks.reconcile,
}));

vi.mock("./collaboration-rooms", () => ({
  publish: mocks.publish,
}));

import { reconcileGen2CollaborationPaths } from "./collaboration-events";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "c010bd2c-a3c1-438f-acef-166287a3b1cb";

describe("reconcileGen2CollaborationPaths", () => {
  it("keeps agent reconciliation within the reported Superset worktree", async () => {
    const snapshot = {
      workspaceId,
      worktreeId: "feature-auth",
      path: "src/login.ts",
    };
    mocks.load.mockResolvedValue(snapshot);
    mocks.reconcile.mockResolvedValue({
      snapshot,
      event: {
        type: "reconciled",
        path: snapshot.path,
        revision: "rev-2",
        update: "AQID",
      },
    });

    await reconcileGen2CollaborationPaths({
      workspaceId,
      userId,
      worktreeId: "feature-auth",
      paths: [snapshot.path],
    });

    expect(mocks.load).toHaveBeenCalledWith(
      workspaceId,
      "feature-auth",
      snapshot.path,
    );
    expect(mocks.publish).toHaveBeenCalledWith(`gen2:${workspaceId}`, {
      type: "reconciled",
      worktreeId: "feature-auth",
      path: snapshot.path,
      revision: "rev-2",
      source: "filesystem",
      update: "AQID",
    });
  });
});

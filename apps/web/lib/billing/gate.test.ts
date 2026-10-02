import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  owner: null as { ownerId: string } | null,
  require: vi.fn(),
}));

vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (mocks.owner ? [mocks.owner] : []),
        }),
      }),
    }),
  }),
}));
vi.mock("./access", () => ({
  requireIndividualPlan: (...args: unknown[]) => mocks.require(...args),
}));

import { requireWorkspaceOwnerPlan } from "./gate";

describe("requireWorkspaceOwnerPlan", () => {
  beforeEach(() => {
    mocks.owner = { ownerId: "owner-1" };
    mocks.require.mockReset().mockResolvedValue(undefined);
  });

  it("checks the owner's plan, not the caller's", async () => {
    await requireWorkspaceOwnerPlan("ws-1");
    expect(mocks.require).toHaveBeenCalledWith("owner-1");
  });

  it("propagates the owner's missing plan", async () => {
    mocks.require.mockRejectedValue(new Error("subscription_required"));
    await expect(requireWorkspaceOwnerPlan("ws-1")).rejects.toThrow(
      "subscription_required",
    );
  });

  it("leaves a missing workspace to the membership check", async () => {
    mocks.owner = null;
    await requireWorkspaceOwnerPlan("ws-missing");
    expect(mocks.require).not.toHaveBeenCalled();
  });
});

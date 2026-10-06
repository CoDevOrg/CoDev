vi.mock("./workspace-entitlement", () => ({
  getWorkspaceOwnerEntitlement: vi.fn(async () => ({
    tier: "paid",
    enabled: true,
    unlimited: false,
    ownedWorkspaceCount: 1,
    usageWindow: "month",
    monthlyLimitMs: 60_000_000,
    workspaceLimit: 1,
    activeWorkspaceLimit: 1,
  })),
}));
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
vi.mock("../gen2/free-compute-claim", () => ({
  reserveFreeWorkspaceCompute: vi.fn(),
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

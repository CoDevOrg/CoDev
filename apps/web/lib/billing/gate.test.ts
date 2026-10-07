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
  owner: null as { ownerId: string; runtimeProvider?: string } | null,
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

import { getWorkspaceOwnerEntitlement } from "./workspace-entitlement";
import { reserveFreeWorkspaceCompute } from "../gen2/free-compute-claim";
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

it("lets collaborators reserve an eligible Free owner's ARM allowance without a paid seat", async () => {
  mocks.owner = { ownerId: "free-owner", runtimeProvider: "azure_arm" };
  vi.mocked(getWorkspaceOwnerEntitlement).mockResolvedValueOnce({
    tier: "free",
    enabled: true,
    unlimited: false,
    ownedWorkspaceCount: 1,
    usageWindow: "lifetime",
    monthlyLimitMs: 5 * 3_600_000,
    workspaceLimit: 1,
    activeWorkspaceLimit: 1,
  });
  mocks.require.mockClear();
  await requireWorkspaceOwnerPlan("shared-workspace");
  expect(getWorkspaceOwnerEntitlement).toHaveBeenCalledWith("free-owner");
  expect(mocks.require).not.toHaveBeenCalled();
  expect(reserveFreeWorkspaceCompute).toHaveBeenCalledWith("shared-workspace");
});

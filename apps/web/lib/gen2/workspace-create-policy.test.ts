import type { Gen2OwnerComputeEntitlement } from "@codev/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComputeTransaction } from "./compute-database";

const mocks = vi.hoisted(() => ({ entitlement: vi.fn() }));
vi.mock("../billing/workspace-entitlement", () => ({
  getWorkspaceOwnerEntitlement: mocks.entitlement,
}));

import { workspaceCreationPolicy } from "./workspace-create-policy";

const db = {} as ComputeTransaction;
const policy: Gen2OwnerComputeEntitlement = {
  tier: "paid",
  enabled: true,
  unlimited: false,
  ownedWorkspaceCount: 1,
  usageWindow: "month",
  monthlyLimitMs: 60_000_000,
  workspaceLimit: 2,
  activeWorkspaceLimit: 2,
};

describe("workspace runtime creation policy", () => {
  beforeEach(() => mocks.entitlement.mockReset().mockResolvedValue(policy));

  it.each([false, true])(
    "routes paid/admin owners to ARM without free quota acknowledgment (unlimited=%s)",
    async (unlimited) => {
      mocks.entitlement.mockResolvedValue({ ...policy, unlimited });

      await expect(
        workspaceCreationPolicy(db, "owner", 1, false),
      ).resolves.toBe("azure_arm");
    },
  );

  it("keeps free compute disabled when the owner is ineligible", async () => {
    mocks.entitlement.mockResolvedValue({
      ...policy,
      tier: "free",
      enabled: false,
    });

    await expect(
      workspaceCreationPolicy(db, "owner", 0, false),
    ).rejects.toThrow();
  });

  it("routes an eligible free owner's first workspace to ARM", async () => {
    mocks.entitlement.mockResolvedValue({ ...policy, tier: "free" });

    await expect(workspaceCreationPolicy(db, "owner", 0, false)).resolves.toBe(
      "azure_arm",
    );
  });

  it("enforces the workspace limit without a legacy quota acknowledgment", async () => {
    mocks.entitlement.mockResolvedValue({
      ...policy,
      tier: "free",
      workspaceLimit: 1,
    });

    await expect(
      workspaceCreationPolicy(db, "owner", 1, false),
    ).rejects.toMatchObject({ status: 409 });
  });
});

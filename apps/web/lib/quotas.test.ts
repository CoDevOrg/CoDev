import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceCreditStatus: vi.fn(),
  isUserAdmin: vi.fn(),
}));

vi.mock("./admin", () => ({ isUserAdmin: mocks.isUserAdmin }));
vi.mock("./compute-credits", () => ({
  getWorkspaceCreditStatus: mocks.getWorkspaceCreditStatus,
}));
vi.mock("./database", () => ({ getDatabase: vi.fn() }));
vi.mock("./rate-limit", () => ({ consumeRateLimit: vi.fn() }));
vi.mock("./vm-usage", () => ({
  getVmMinutesUsed: vi.fn(),
  VM_MINUTE_LIFETIME_QUOTA: 20_000,
}));

import { assertWorkspaceCreditQuota } from "./quotas";

describe("assertWorkspaceCreditQuota", () => {
  it("lets application admins start compute without consuming pooled credit", async () => {
    mocks.isUserAdmin.mockResolvedValue(true);

    await expect(
      assertWorkspaceCreditQuota("workspace-1", "admin-1"),
    ).resolves.toBeUndefined();
    expect(mocks.getWorkspaceCreditStatus).not.toHaveBeenCalled();
  });

  it("explains the pooled allowance and reset when a member is exhausted", async () => {
    mocks.isUserAdmin.mockResolvedValue(false);
    mocks.getWorkspaceCreditStatus.mockResolvedValue({
      remainingMinutes: 0,
      memberCount: 2,
      allottedUsd: 10,
    });

    await expect(
      assertWorkspaceCreditQuota("workspace-1", "user-1"),
    ).rejects.toMatchObject({
      code: "workspace_credit_quota",
      message:
        "This workspace's monthly compute allowance is exhausted. It includes $10.00 per calendar month pooled across 2 non-admin members. It resets at the start of next month.",
    });
  });
});
